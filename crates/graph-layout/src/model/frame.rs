//! The columnar frame (ADR 0011, Decision 6): the bytes a `Graph` and a `Layout` cross the boundary as. The encoding is the
//! one `packages/graph-layout/src/frame.ts` writes, byte for byte: its header comment is the specification. The golden
//! inputs of both languages are `packages/graph-layout/src/testing/frameGolden.ts`; `fixtures/parity/frame.txt` holds
//! their TypeScript encodings, which the tests here decode and encode again.

use std::fmt;

use super::{
    ClusterRects, Clusters, EdgeLayouts, Edges, Graph, Hints, Layout, Metrics, NodeLayouts, Nodes,
    PartitionRects, Ports, Rect,
};

/// The four bytes that open every frame.
pub const MAGIC: [u8; 4] = *b"GLFR";
/// The version this module writes, and the only one it reads.
pub const VERSION: u32 = 1;

const KIND_GRAPH: u32 = 1;
const KIND_LAYOUT: u32 = 2;
const TAG_U8: u8 = 1;
const TAG_U32: u8 = 2;
const TAG_F64: u8 = 3;
const TAG_TEXT: u8 = 4;

/// A frame that does not decode: a wrong magic, version or kind, a column of the wrong type or length, a value the
/// table cannot hold, or bytes left over after the last column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameError {
    message: String,
}

impl FrameError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "graph layout frame: {}", self.message)
    }
}

impl std::error::Error for FrameError {}

/// The error for a column that ends before its rows do.
fn short() -> FrameError {
    FrameError::new("the bytes end inside a field")
}

/// A count or an offset as the frame stores it. Rows and blob bytes stay below 2^32 in any graph the core can hold.
fn word(value: usize) -> u32 {
    u32::try_from(value).expect("a frame holds fewer than 2^32 rows and blob bytes")
}

/// A stored offset as an index. A value that does not fit a `usize` is out of range of any blob, so it saturates.
fn index(value: u32) -> usize {
    usize::try_from(value).unwrap_or(usize::MAX)
}

/// Builds one frame: the columns, and the blob their texts point into.
#[derive(Default)]
struct Writer {
    columns: Vec<u8>,
    blob: Vec<u8>,
}

impl Writer {
    fn column(&mut self, tag: u8, rows: usize, payload: &[u8]) {
        self.columns.push(tag);
        self.columns.extend_from_slice(&word(rows).to_le_bytes());
        self.columns.extend_from_slice(payload);
    }

    fn bytes(&mut self, values: &[u8]) {
        self.column(TAG_U8, values.len(), values);
    }

    fn bools(&mut self, values: &[bool]) {
        let payload: Vec<u8> = values.iter().map(|&value| u8::from(value)).collect();
        self.column(TAG_U8, values.len(), &payload);
    }

    fn u32s(&mut self, values: &[u32]) {
        let payload: Vec<u8> = values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        self.column(TAG_U32, values.len(), &payload);
    }

    fn f64s(&mut self, values: &[f64]) {
        let payload: Vec<u8> = values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        self.column(TAG_F64, values.len(), &payload);
    }

    fn texts<S: AsRef<str>>(&mut self, values: &[S]) {
        let mut offsets = Vec::with_capacity(values.len() + 1);
        for value in values {
            offsets.push(word(self.blob.len()));
            self.blob.extend_from_slice(value.as_ref().as_bytes());
        }
        offsets.push(word(self.blob.len()));
        let payload: Vec<u8> = offsets
            .iter()
            .flat_map(|offset| offset.to_le_bytes())
            .collect();
        self.column(TAG_TEXT, values.len(), &payload);
    }

    fn opt_texts(&mut self, values: &[Option<String>]) {
        let present: Vec<bool> = values.iter().map(Option::is_some).collect();
        self.bools(&present);
        let texts: Vec<&str> = values
            .iter()
            .map(|value| value.as_deref().unwrap_or(""))
            .collect();
        self.texts(&texts);
    }

    fn opt_f64s(&mut self, values: &[Option<f64>]) {
        let present: Vec<bool> = values.iter().map(Option::is_some).collect();
        self.bools(&present);
        let numbers: Vec<f64> = values.iter().map(|value| value.unwrap_or(0.0)).collect();
        self.f64s(&numbers);
    }

    fn opt_bools(&mut self, values: &[Option<bool>]) {
        let codes: Vec<u8> = values
            .iter()
            .map(|value| match value {
                None => 0,
                Some(false) => 1,
                Some(true) => 2,
            })
            .collect();
        self.bytes(&codes);
    }

    fn finish(self, kind: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity(16 + self.blob.len() + self.columns.len());
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&word(self.blob.len()).to_le_bytes());
        out.extend_from_slice(&self.blob);
        out.extend_from_slice(&self.columns);
        out
    }
}

/// Reads one frame: the header and blob first, then the columns in order, each checked against what the caller
/// expects.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    blob: &'a [u8],
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8], kind: u32) -> Result<Self, FrameError> {
        let mut reader = Self {
            bytes,
            at: 0,
            blob: &[],
        };
        if reader.take(4)? != MAGIC.as_slice() {
            return Err(FrameError::new("the magic is not GLFR"));
        }
        let version = reader.u32()?;
        if version != VERSION {
            return Err(FrameError::new(format!(
                "version {version} is not {VERSION}"
            )));
        }
        let found = reader.u32()?;
        if found != kind {
            return Err(FrameError::new(format!("kind {found} is not {kind}")));
        }
        let blob_length = reader.size()?;
        reader.blob = reader.take(blob_length)?;
        Ok(reader)
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], FrameError> {
        let bytes = self.bytes;
        let end = self.at.checked_add(count).ok_or_else(short)?;
        let out = bytes.get(self.at..end).ok_or_else(short)?;
        self.at = end;
        Ok(out)
    }

    fn fixed<const N: usize>(&mut self) -> Result<[u8; N], FrameError> {
        self.take(N)?.try_into().map_err(|_| short())
    }

    fn u32(&mut self) -> Result<u32, FrameError> {
        Ok(u32::from_le_bytes(self.fixed::<4>()?))
    }

    fn size(&mut self) -> Result<usize, FrameError> {
        let value = self.u32()?;
        usize::try_from(value)
            .map_err(|_| FrameError::new(format!("{value} rows do not fit this platform")))
    }

    /// Reads a column's tag and row count, and checks them. Returns the row count.
    fn column(&mut self, name: &str, tag: u8, rows: Option<usize>) -> Result<usize, FrameError> {
        if self.take(1)? != [tag].as_slice() {
            return Err(FrameError::new(format!(
                "{name} is not a column of type {tag}"
            )));
        }
        let count = self.size()?;
        if let Some(expected) = rows.filter(|&expected| expected != count) {
            return Err(FrameError::new(format!(
                "{name} has {count} rows, not {expected}"
            )));
        }
        Ok(count)
    }

    fn u32_values(&mut self, count: usize) -> Result<Vec<u32>, FrameError> {
        (0..count).map(|_| self.u32()).collect()
    }

    fn f64_values(&mut self, count: usize) -> Result<Vec<f64>, FrameError> {
        (0..count)
            .map(|_| Ok(f64::from_le_bytes(self.fixed::<8>()?)))
            .collect()
    }

    fn bytes(&mut self, name: &str, rows: Option<usize>) -> Result<&'a [u8], FrameError> {
        let count = self.column(name, TAG_U8, rows)?;
        self.take(count)
    }

    fn bools(&mut self, name: &str, rows: Option<usize>) -> Result<Vec<bool>, FrameError> {
        self.bytes(name, rows)?
            .iter()
            .map(|&value| match value {
                0 => Ok(false),
                1 => Ok(true),
                _ => Err(FrameError::new(format!(
                    "{name} holds {value}, not a boolean"
                ))),
            })
            .collect()
    }

    fn u32s(&mut self, name: &str, rows: Option<usize>) -> Result<Vec<u32>, FrameError> {
        let count = self.column(name, TAG_U32, rows)?;
        self.u32_values(count)
    }

    fn f64s(&mut self, name: &str, rows: Option<usize>) -> Result<Vec<f64>, FrameError> {
        let count = self.column(name, TAG_F64, rows)?;
        self.f64_values(count)
    }

    fn texts(&mut self, name: &str, rows: Option<usize>) -> Result<Vec<String>, FrameError> {
        let count = self.column(name, TAG_TEXT, rows)?;
        let offsets = self.u32_values(count + 1)?;
        let blob = self.blob;
        offsets
            .iter()
            .zip(offsets.iter().skip(1))
            .map(|(&start, &end)| {
                let raw = blob.get(index(start)..index(end)).ok_or_else(|| {
                    FrameError::new(format!("{name} has an offset outside the blob"))
                })?;
                std::str::from_utf8(raw)
                    .map(str::to_owned)
                    .map_err(|_| FrameError::new(format!("{name} holds text that is not UTF-8")))
            })
            .collect()
    }

    fn opt_texts(&mut self, name: &str, rows: usize) -> Result<Vec<Option<String>>, FrameError> {
        let present = self.bools(name, Some(rows))?;
        let texts = self.texts(name, Some(rows))?;
        Ok(present
            .into_iter()
            .zip(texts)
            .map(|(here, text)| here.then_some(text))
            .collect())
    }

    fn opt_f64s(&mut self, name: &str, rows: usize) -> Result<Vec<Option<f64>>, FrameError> {
        let present = self.bools(name, Some(rows))?;
        let values = self.f64s(name, Some(rows))?;
        Ok(present
            .into_iter()
            .zip(values)
            .map(|(here, value)| here.then_some(value))
            .collect())
    }

    fn opt_bools(&mut self, name: &str, rows: usize) -> Result<Vec<Option<bool>>, FrameError> {
        self.bytes(name, Some(rows))?
            .iter()
            .map(|&code| match code {
                0 => Ok(None),
                1 => Ok(Some(false)),
                2 => Ok(Some(true)),
                _ => Err(FrameError::new(format!(
                    "{name} holds {code}, not an optional boolean"
                ))),
            })
            .collect()
    }

    fn end(&self) -> Result<(), FrameError> {
        if self.at != self.bytes.len() {
            return Err(FrameError::new("the bytes go on after the last column"));
        }
        Ok(())
    }
}

/// The frame of a graph (`Graph`), columns in the order `frame.ts` writes them.
#[must_use]
pub fn encode_graph(graph: &Graph) -> Vec<u8> {
    let mut writer = Writer::default();
    put_nodes(&mut writer, &graph.nodes);
    put_edges(&mut writer, &graph.edges);
    put_clusters(&mut writer, &graph.clusters);
    writer.finish(KIND_GRAPH)
}

fn put_nodes(writer: &mut Writer, nodes: &Nodes) {
    writer.texts(&nodes.id);
    writer.f64s(&nodes.width);
    writer.f64s(&nodes.height);
    writer.opt_texts(&nodes.cluster);
    writer.opt_f64s(&nodes.partition);
    writer.u32s(&nodes.ports.node);
    writer.texts(&nodes.ports.id);
    writer.texts(&nodes.ports.side);
    writer.f64s(&nodes.ports.offset);
}

fn put_edges(writer: &mut Writer, edges: &Edges) {
    writer.texts(&edges.id);
    writer.texts(&edges.source);
    writer.texts(&edges.target);
    writer.opt_texts(&edges.source_port);
    writer.opt_texts(&edges.target_port);
    writer.texts(&edges.kind);
}

fn put_clusters(writer: &mut Writer, clusters: &Clusters) {
    writer.texts(&clusters.id);
    writer.opt_texts(&clusters.parent);
    writer.opt_f64s(&clusters.padding);
    writer.opt_f64s(&clusters.label_height);
    writer.opt_bools(&clusters.opaque);
}

/// The graph a frame of a graph holds.
///
/// # Errors
///
/// Returns a `FrameError` when the bytes are not a graph frame of this version, or when a port names a node the frame
/// does not hold.
pub fn decode_graph(bytes: &[u8]) -> Result<Graph, FrameError> {
    let mut reader = Reader::new(bytes, KIND_GRAPH)?;
    let nodes = read_nodes(&mut reader)?;
    let edges = read_edges(&mut reader)?;
    let clusters = read_clusters(&mut reader)?;
    reader.end()?;
    Ok(Graph {
        nodes,
        edges,
        clusters,
    })
}

fn read_nodes(reader: &mut Reader<'_>) -> Result<Nodes, FrameError> {
    let id = reader.texts("nodes.id", None)?;
    let count = id.len();
    let width = reader.f64s("nodes.width", Some(count))?;
    let height = reader.f64s("nodes.height", Some(count))?;
    let cluster = reader.opt_texts("nodes.cluster", count)?;
    let partition = reader.opt_f64s("nodes.partition", count)?;
    let node = reader.u32s("ports.node", None)?;
    let ports = node.len();
    if node.iter().any(|&owner| index(owner) >= count) {
        return Err(FrameError::new("ports.node names no node"));
    }
    let port_id = reader.texts("ports.id", Some(ports))?;
    let side = reader.texts("ports.side", Some(ports))?;
    let offset = reader.f64s("ports.offset", Some(ports))?;
    Ok(Nodes {
        id,
        width,
        height,
        cluster,
        partition,
        ports: Ports {
            node,
            id: port_id,
            side,
            offset,
        },
    })
}

fn read_edges(reader: &mut Reader<'_>) -> Result<Edges, FrameError> {
    let id = reader.texts("edges.id", None)?;
    let count = id.len();
    let source = reader.texts("edges.source", Some(count))?;
    let target = reader.texts("edges.target", Some(count))?;
    let source_port = reader.opt_texts("edges.sourcePort", count)?;
    let target_port = reader.opt_texts("edges.targetPort", count)?;
    let kind = reader.texts("edges.kind", Some(count))?;
    Ok(Edges {
        id,
        source,
        target,
        source_port,
        target_port,
        kind,
    })
}

fn read_clusters(reader: &mut Reader<'_>) -> Result<Clusters, FrameError> {
    let id = reader.texts("clusters.id", None)?;
    let count = id.len();
    let parent = reader.opt_texts("clusters.parent", count)?;
    let padding = reader.opt_f64s("clusters.padding", count)?;
    let label_height = reader.opt_f64s("clusters.labelHeight", count)?;
    let opaque = reader.opt_bools("clusters.opaque", count)?;
    Ok(Clusters {
        id,
        parent,
        padding,
        label_height,
        opaque,
    })
}

/// The frame of a layout (`Layout`), columns in the order `frame.ts` writes them.
#[must_use]
pub fn encode_layout(layout: &Layout) -> Vec<u8> {
    let mut writer = Writer::default();
    put_node_layouts(&mut writer, &layout.nodes);
    put_edge_layouts(&mut writer, &layout.edges);
    put_cluster_rects(&mut writer, &layout.clusters);
    put_partition_rects(&mut writer, &layout.partitions);
    let bounds = &layout.bounds;
    writer.f64s(&[bounds.x, bounds.y, bounds.width, bounds.height]);
    put_hints(&mut writer, &layout.hints);
    let metrics = &layout.metrics;
    writer.f64s(&[
        metrics.crossings,
        metrics.bends,
        metrics.edge_length,
        metrics.area,
        metrics.density,
        metrics.overlaps,
        metrics.opaque_breaches,
    ]);
    writer.finish(KIND_LAYOUT)
}

fn put_node_layouts(writer: &mut Writer, nodes: &NodeLayouts) {
    writer.texts(&nodes.id);
    writer.f64s(&nodes.x);
    writer.f64s(&nodes.y);
    writer.f64s(&nodes.width);
    writer.f64s(&nodes.height);
    writer.u32s(&nodes.rank);
    writer.u32s(&nodes.order);
}

fn put_edge_layouts(writer: &mut Writer, edges: &EdgeLayouts) {
    writer.texts(&edges.id);
    writer.u32s(&edges.point_start);
    writer.f64s(&edges.point_x);
    writer.f64s(&edges.point_y);
    writer.bools(&edges.reversed);
    writer.bools(&edges.route_failed);
}

fn put_cluster_rects(writer: &mut Writer, clusters: &ClusterRects) {
    writer.texts(&clusters.id);
    writer.f64s(&clusters.x);
    writer.f64s(&clusters.y);
    writer.f64s(&clusters.width);
    writer.f64s(&clusters.height);
}

fn put_partition_rects(writer: &mut Writer, partitions: &PartitionRects) {
    writer.f64s(&partitions.partition);
    writer.f64s(&partitions.x);
    writer.f64s(&partitions.y);
    writer.f64s(&partitions.width);
    writer.f64s(&partitions.height);
}

fn put_hints(writer: &mut Writer, hints: &Hints) {
    writer.texts(&hints.id);
    writer.u32s(&hints.rank);
    writer.u32s(&hints.order);
    writer.f64s(&hints.x);
    writer.f64s(&hints.y);
}

/// The layout a frame of a layout holds.
///
/// # Errors
///
/// Returns a `FrameError` when the bytes are not a layout frame of this version, or when the edge points do not run
/// from zero to the point count.
pub fn decode_layout(bytes: &[u8]) -> Result<Layout, FrameError> {
    let mut reader = Reader::new(bytes, KIND_LAYOUT)?;
    let nodes = read_node_layouts(&mut reader)?;
    let edges = read_edge_layouts(&mut reader)?;
    let clusters = read_cluster_rects(&mut reader)?;
    let partitions = read_partition_rects(&mut reader)?;
    let bounds = read_rect(&mut reader)?;
    let hints = read_hints(&mut reader)?;
    let metrics = read_metrics(&mut reader)?;
    reader.end()?;
    Ok(Layout {
        nodes,
        edges,
        clusters,
        partitions,
        bounds,
        hints,
        metrics,
    })
}

fn read_node_layouts(reader: &mut Reader<'_>) -> Result<NodeLayouts, FrameError> {
    let id = reader.texts("nodes.id", None)?;
    let count = id.len();
    Ok(NodeLayouts {
        id,
        x: reader.f64s("nodes.x", Some(count))?,
        y: reader.f64s("nodes.y", Some(count))?,
        width: reader.f64s("nodes.width", Some(count))?,
        height: reader.f64s("nodes.height", Some(count))?,
        rank: reader.u32s("nodes.rank", Some(count))?,
        order: reader.u32s("nodes.order", Some(count))?,
    })
}

fn read_edge_layouts(reader: &mut Reader<'_>) -> Result<EdgeLayouts, FrameError> {
    let id = reader.texts("edges.id", None)?;
    let count = id.len();
    let point_start = reader.u32s("edges.pointStart", Some(count + 1))?;
    let point_x = reader.f64s("edges.pointX", None)?;
    let points = point_x.len();
    let point_y = reader.f64s("edges.pointY", Some(points))?;
    let reversed = reader.bools("edges.reversed", Some(count))?;
    let route_failed = reader.bools("edges.routeFailed", Some(count))?;
    let runs_over_points = point_start.first() == Some(&0)
        && point_start.last().map(|&last| index(last)) == Some(points)
        && point_start
            .windows(2)
            .all(|pair| matches!(pair, [start, end] if start <= end));
    if !runs_over_points {
        return Err(FrameError::new(
            "edges.pointStart does not run from 0 to the point count",
        ));
    }
    Ok(EdgeLayouts {
        id,
        point_start,
        point_x,
        point_y,
        reversed,
        route_failed,
    })
}

fn read_cluster_rects(reader: &mut Reader<'_>) -> Result<ClusterRects, FrameError> {
    let id = reader.texts("clusters.id", None)?;
    let count = id.len();
    Ok(ClusterRects {
        id,
        x: reader.f64s("clusters.x", Some(count))?,
        y: reader.f64s("clusters.y", Some(count))?,
        width: reader.f64s("clusters.width", Some(count))?,
        height: reader.f64s("clusters.height", Some(count))?,
    })
}

fn read_partition_rects(reader: &mut Reader<'_>) -> Result<PartitionRects, FrameError> {
    let partition = reader.f64s("partitions.partition", None)?;
    let count = partition.len();
    Ok(PartitionRects {
        partition,
        x: reader.f64s("partitions.x", Some(count))?,
        y: reader.f64s("partitions.y", Some(count))?,
        width: reader.f64s("partitions.width", Some(count))?,
        height: reader.f64s("partitions.height", Some(count))?,
    })
}

/// A rectangle stored as four numbers, in the order x, y, width, height.
fn read_rect(reader: &mut Reader<'_>) -> Result<Rect, FrameError> {
    match reader.f64s("bounds", Some(4))?.as_slice() {
        &[x, y, width, height] => Ok(Rect {
            x,
            y,
            width,
            height,
        }),
        _ => Err(FrameError::new("bounds is not four numbers")),
    }
}

fn read_hints(reader: &mut Reader<'_>) -> Result<Hints, FrameError> {
    let id = reader.texts("hints.id", None)?;
    let count = id.len();
    Ok(Hints {
        id,
        rank: reader.u32s("hints.rank", Some(count))?,
        order: reader.u32s("hints.order", Some(count))?,
        x: reader.f64s("hints.x", Some(count))?,
        y: reader.f64s("hints.y", Some(count))?,
    })
}

fn read_metrics(reader: &mut Reader<'_>) -> Result<Metrics, FrameError> {
    match reader.f64s("metrics", Some(7))?.as_slice() {
        &[
            crossings,
            bends,
            edge_length,
            area,
            density,
            overlaps,
            opaque_breaches,
        ] => Ok(Metrics {
            crossings,
            bends,
            edge_length,
            area,
            density,
            overlaps,
            opaque_breaches,
        }),
        _ => Err(FrameError::new("metrics is not seven numbers")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::frame_fixture as fixture;

    #[test]
    fn the_typescript_golden_graph_decodes_and_encodes_to_the_same_bytes() {
        let bytes = fixture("graph");
        let graph = decode_graph(&bytes).expect("the golden graph decodes");
        assert_eq!(graph.nodes.id, ["orders", "ñ-stock", "customers"]);
        assert_eq!(graph.nodes.ports.node, [0, 0, 2]);
        assert_eq!(graph.edges.target_port[1].as_deref(), Some("in"));
        assert_eq!(graph.clusters.opaque, [Some(true), None]);
        assert_eq!(encode_graph(&graph), bytes);
    }

    #[test]
    fn the_typescript_golden_layout_decodes_and_encodes_to_the_same_bytes() {
        let bytes = fixture("layout");
        let layout = decode_layout(&bytes).expect("the golden layout decodes");
        assert_eq!(layout.edges.point_start, [0, 4, 4, 6]);
        assert_eq!(layout.edges.reversed, [false, false, true]);
        assert_eq!(layout.bounds.x, -12.0);
        assert_eq!(layout.metrics.opaque_breaches, 1.0);
        assert_eq!(encode_layout(&layout), bytes);
    }

    #[test]
    fn a_graph_round_trips_through_every_optional_column() {
        let graph = Graph {
            nodes: Nodes {
                id: vec!["a".into(), "b".into()],
                width: vec![1.0, 2.0],
                height: vec![3.0, 4.0],
                cluster: vec![Some("c".into()), None],
                partition: vec![None, Some(1.5)],
                ports: Ports {
                    node: vec![1],
                    id: vec!["p".into()],
                    side: vec!["west".into()],
                    offset: vec![0.5],
                },
            },
            edges: Edges {
                id: vec!["e".into()],
                source: vec!["a".into()],
                target: vec!["b".into()],
                source_port: vec![None],
                target_port: vec![Some("p".into())],
                kind: vec!["ref".into()],
            },
            clusters: Clusters {
                id: vec!["c".into()],
                parent: vec![None],
                padding: vec![Some(2.0)],
                label_height: vec![None],
                opaque: vec![Some(false)],
            },
        };
        let bytes = encode_graph(&graph);
        assert_eq!(decode_graph(&bytes), Ok(graph));
    }

    #[test]
    fn an_empty_graph_and_an_empty_layout_round_trip() {
        let bytes = encode_graph(&Graph::default());
        assert_eq!(decode_graph(&bytes), Ok(Graph::default()));
        // A layout with no edges still carries one point_start entry: the zero that opens the run of points.
        let layout = Layout {
            edges: EdgeLayouts {
                point_start: vec![0],
                ..EdgeLayouts::default()
            },
            ..Layout::default()
        };
        let bytes = encode_layout(&layout);
        assert_eq!(decode_layout(&bytes), Ok(layout));
    }

    #[test]
    fn a_frame_opens_with_the_magic_the_version_and_the_kind() {
        let bytes = fixture("graph");
        assert_eq!(&bytes[..4], MAGIC.as_slice());
        assert_eq!(&bytes[4..8], VERSION.to_le_bytes().as_slice());
        assert_eq!(&bytes[8..12], KIND_GRAPH.to_le_bytes().as_slice());
    }

    #[test]
    fn a_frame_of_the_wrong_kind_is_refused() {
        assert!(decode_layout(&fixture("graph")).is_err());
        let error = decode_graph(&fixture("layout")).expect_err("a layout is not a graph");
        assert!(error.to_string().contains("kind 2 is not 1"), "{error}");
    }

    #[test]
    fn bad_magic_a_bad_version_and_trailing_bytes_are_refused() {
        let bytes = fixture("graph");
        let mut bad_magic = bytes.clone();
        bad_magic[0] = b'X';
        assert!(decode_graph(&bad_magic).is_err());
        let mut bad_version = bytes.clone();
        bad_version[4] = 2;
        let error = decode_graph(&bad_version).expect_err("version 2 is not read");
        assert!(error.to_string().contains("version 2"), "{error}");
        let mut trailing = bytes;
        trailing.push(0);
        let error = decode_graph(&trailing).expect_err("trailing bytes are refused");
        assert!(
            error.to_string().contains("after the last column"),
            "{error}"
        );
    }

    #[test]
    fn a_truncated_frame_is_refused() {
        let bytes = fixture("layout");
        assert!(decode_layout(&bytes[..bytes.len() - 3]).is_err());
    }

    #[test]
    fn a_port_whose_node_is_not_in_the_frame_is_refused() {
        let mut bytes = fixture("graph");
        // The first u32 column is `ports.node`: its tag (2) and its row count (3, the golden's three ports).
        let owners = bytes
            .windows(5)
            .position(|window| window == [2, 3, 0, 0, 0])
            .expect("the owner column is in the frame")
            + 5;
        bytes[owners..owners + 4].copy_from_slice(&99u32.to_le_bytes());
        let error = decode_graph(&bytes).expect_err("a port names no node");
        assert!(error.to_string().contains("names no node"), "{error}");
    }

    #[test]
    fn a_layout_whose_points_do_not_add_up_is_refused() {
        let mut layout = decode_layout(&fixture("layout")).expect("the golden layout decodes");
        if let Some(last) = layout.edges.point_start.last_mut() {
            *last = 99;
        }
        let error =
            decode_layout(&encode_layout(&layout)).expect_err("the points run past the count");
        assert!(error.to_string().contains("pointStart"), "{error}");
    }
}
