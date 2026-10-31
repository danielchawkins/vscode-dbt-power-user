//! Layering against TypeScript: the ranks, reversed edges and dummy chains that `rank` and `layer` give on the cases of
//! `fixtures/parity/layering-cases.txt` (the package's graphs, the negative-zero bands, and seeded random graphs, printed
//! by `scripts/parity/print-fixtures.mjs layering`), and on the finance graph when `GRAPH_LAYOUT_LAYERING_FINANCE` names
//! its dump (`print-fixtures.mjs layering-finance <manifest>`), as the finance placement check reads its dump.
//!
//! A case equal to TypeScript has the same ranks (bit for bit) and the same dummy chains: each chain is the nodes and
//! dummies in order, a dummy written by its key (owner edge index, rank, position). A case that differs is allowed only
//! if its total edge length is no worse than TypeScript's, and the count of such cases is pinned, so a new difference
//! fails until it is recorded in `fixtures/parity/layering-discrepancies.md`.

use std::fmt::Write as _;

use crate::budget::Budget;
use crate::index::Indexed;
use crate::layering::{
    ChainNode, EdgeRule, Layers, PartitionMode, RankOptions, Ranks, Scratch, layer, rank,
};

const FIXTURE: &str = include_str!("../fixtures/parity/layering-cases.txt");
/// Cases of the fixtures whose ranks or chains differ from TypeScript. See `layering-discrepancies.md`.
const KNOWN_DIFFERENCES: usize = 0;
/// Cases of the finance dump that differ from TypeScript. The dump is read only when its variable is set.
const FINANCE_DIFFERENCES: usize = 0;
/// Relative rounding allowed in a total edge length.
const ROUNDING: f64 = 1e-12;

/// What ranking and layering give for one case: the ranks, the reversed ranking edges, and the chains as text. The
/// chains are written twice: `chains` as TypeScript's fixture writes them (a dummy's rank by `Display`), for the
/// comparison, and `chain_bits` with each dummy's rank as IEEE bits, for the native and WASI outputs.
#[derive(Debug)]
struct Output {
    ranks: Vec<f64>,
    reversed: Vec<usize>,
    chains: String,
    chain_bits: String,
}

/// What TypeScript gives for one case, as the fixture writes it: the ranks, the reversed edges and the chains.
#[derive(Debug)]
struct Expected {
    ranks: Vec<f64>,
    reversed: Vec<usize>,
    chains: String,
}

/// One case: its input, and what TypeScript gives for it.
struct Case {
    name: String,
    mode: PartitionMode,
    bands: Vec<Option<f64>>,
    count: usize,
    ends: Vec<(usize, usize)>,
    rules: Vec<EdgeRule>,
    expected: Expected,
}

fn bits_of(text: &str) -> Vec<f64> {
    if text == "-" {
        return Vec::new();
    }
    text.split(',')
        .map(|h| f64::from_bits(u64::from_str_radix(h, 16).expect("a hex bit pattern")))
        .collect()
}

fn indices_of(text: &str) -> Vec<usize> {
    if text == "-" {
        return Vec::new();
    }
    text.split(',')
        .map(|i| i.parse().expect("an edge index"))
        .collect()
}

/// Parses `fixtures/parity/layering-cases.txt`: comment lines are skipped, and each case has eight tab-separated fields.
fn parse(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|line| !line.starts_with('#') && !line.is_empty())
        .map(|line| {
            let f: Vec<&str> = line.split('\t').collect();
            assert_eq!(f.len(), 8, "a layering case has eight fields: {line}");
            assert_eq!(f[0], "case");
            let mode = match f[2] {
                "none" => PartitionMode::None,
                "soft" => PartitionMode::Soft,
                "strict" => PartitionMode::Strict,
                other => panic!("unknown partition mode {other}"),
            };
            let bands: Vec<Option<f64>> = f[3]
                .split(',')
                .map(|b| (b != "-").then(|| bits_of(b)[0]))
                .collect();
            let mut ends = Vec::new();
            let mut rules = Vec::new();
            if f[4] != "-" {
                for edge in f[4].split(';') {
                    let p: Vec<&str> = edge.split(':').collect();
                    ends.push((p[0].parse().expect("a node"), p[1].parse().expect("a node")));
                    rules.push(EdgeRule {
                        ports: [None, None],
                        kind: p[2].parse().expect("a kind"),
                        ranks: p[3] == "1",
                        min_length: p[4].parse().expect("a minimum length"),
                        weight: p[5].parse().expect("a weight"),
                    });
                }
            }
            Case {
                name: f[1].to_owned(),
                mode,
                count: bands.len(),
                bands,
                ends,
                rules,
                expected: Expected {
                    ranks: bits_of(f[5]),
                    reversed: indices_of(f[6]),
                    chains: f[7].to_owned(),
                },
            }
        })
        .collect()
}

/// The chains as text: bundles in order, separated by `;`; a bundle's nodes and dummies by `,`. A node is `n<index>`;
/// a dummy is `d<owner>:<rank>:<position>`, the key the TypeScript dump prints, with the rank written by `dummy_rank`.
fn chains_text(layers: &Layers, dummy_rank: fn(f64) -> String) -> String {
    if layers.bundles.is_empty() {
        return "-".to_owned();
    }
    layers
        .bundles
        .iter()
        .map(|bundle| {
            bundle
                .chain
                .iter()
                .map(|&x| match x {
                    ChainNode::Node(i) => format!("n{i}"),
                    ChainNode::Dummy(d) => {
                        let key = layers.dummies[d];
                        format!("d{}:{}:{}", key.owner, dummy_rank(key.rank), key.position)
                    }
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// Ranks and lays out one case: the ranking, then the layers (the bundles and their chains).
fn rank_and_layer(case: &Case, scratch: &mut Scratch) -> (Ranks, Layers) {
    let budget = Budget::for_effort(None).expect("the balanced budget exists");
    let graph = Indexed::from_ends(
        case.count,
        case.ends
            .iter()
            .map(|&(s, t)| {
                Some((
                    u32::try_from(s).expect("small"),
                    u32::try_from(t).expect("small"),
                ))
            })
            .collect(),
        &vec![true; case.ends.len()],
    );
    let options = RankOptions {
        partitions: case.mode,
        node_partition: &case.bands,
        edges: &case.rules,
        hints: &[],
        stability: 1.0,
        budget: &budget,
    };
    let ranking = rank(&graph, &options, scratch).expect("the case ranks");
    let layers = layer(&graph, &case.rules, &ranking.ranks);
    (ranking, layers)
}

fn run(case: &Case, scratch: &mut Scratch) -> Output {
    let (ranking, layers) = rank_and_layer(case, scratch);
    Output {
        ranks: ranking.ranks,
        reversed: ranking.reversed,
        chains: chains_text(&layers, |rank| rank.to_string()),
        chain_bits: chains_text(&layers, |rank| format!("{:016x}", rank.to_bits())),
    }
}

fn same_bits(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
}

/// The total weighted length of the ranking edges, each measured in its input direction.
fn edge_length(case: &Case, ranks: &[f64]) -> f64 {
    let mut sum = 0.0;
    for (&(s, t), rule) in case.ends.iter().zip(&case.rules) {
        if rule.ranks && s != t {
            sum += rule.weight * (ranks[t] - ranks[s]).abs();
        }
    }
    sum
}

/// The names of the cases that differ from TypeScript. A difference must not lengthen the total edge length.
fn differences(cases: &[Case]) -> Vec<String> {
    let mut names = Vec::new();
    let mut scratch = Scratch::default();
    for case in cases {
        let got = run(case, &mut scratch);
        if same_bits(&got.ranks, &case.expected.ranks)
            && got.reversed == case.expected.reversed
            && got.chains == case.expected.chains
        {
            continue;
        }
        let ours = edge_length(case, &got.ranks);
        let theirs = edge_length(case, &case.expected.ranks);
        assert!(
            ours <= theirs + ROUNDING * (1.0 + theirs.abs()),
            "{}: total edge length {ours}, TypeScript {theirs}",
            case.name
        );
        names.push(case.name.clone());
    }
    names
}

#[test]
fn ranks_and_chains_match_typescript_on_the_fixtures() {
    let cases = parse(FIXTURE);
    let differing = differences(&cases);
    println!(
        "layering fixtures: {} of {} cases equal to TypeScript in ranks and chains",
        cases.len() - differing.len(),
        cases.len()
    );
    // A new difference must be recorded in layering-discrepancies.md before this changes.
    assert_eq!(
        differing.len(),
        KNOWN_DIFFERENCES,
        "a layering case now differs from TypeScript: {differing:?}"
    );
}

#[test]
fn ranks_and_chains_match_typescript_on_the_finance_graph() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_LAYERING_FINANCE") else {
        return;
    };
    let text = std::fs::read_to_string(&path).expect("the finance dump is readable");
    let cases = parse(&text);
    assert_eq!(cases.len(), 1, "the finance dump holds one case");
    let differing = differences(&cases);
    println!(
        "layering finance: {} nodes and {} edges in the dump, {} differ from TypeScript",
        cases[0].count,
        cases[0].ends.len(),
        differing.len()
    );
    assert_eq!(
        differing.len(),
        FINANCE_DIFFERENCES,
        "the finance graph now differs from TypeScript: {differing:?}"
    );
}

fn bits_text(values: &[f64]) -> String {
    if values.is_empty() {
        return "-".to_owned();
    }
    values
        .iter()
        .map(|v| format!("{:016x}", v.to_bits()))
        .collect::<Vec<_>>()
        .join(",")
}

fn indices_text(values: &[usize]) -> String {
    if values.is_empty() {
        return "-".to_owned();
    }
    values
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// Writes what ranking and layering give for every fixture case, one line per case: the name, the ranks as IEEE bits,
/// the reversed edges, and the chains with dummies by key, each dummy's rank as IEEE bits too. `just crates::layering-parity`
/// runs it natively and under WASI and compares the two files byte for byte, so the dummy ranks are compared exactly.
#[test]
fn layering_outputs_are_written_for_the_parity_comparison() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_LAYERING_OUT") else {
        return;
    };
    let mut text = String::new();
    let mut scratch = Scratch::default();
    for case in parse(FIXTURE) {
        let out = run(&case, &mut scratch);
        writeln!(
            text,
            "{}\t{}\t{}\t{}",
            case.name,
            bits_text(&out.ranks),
            indices_text(&out.reversed),
            out.chain_bits
        )
        .expect("writing to a string");
    }
    std::fs::write(&path, text).expect("the layering output is writable");
}

/// The timing workload: the one case of the file `GRAPH_LAYOUT_LAYERING_TIMING` names, ranked and layered
/// `GRAPH_LAYOUT_LAYERING_REPEATS` times with one `Scratch`, as `scripts/bench/layering-timings.mjs` times it. The first
/// run must equal TypeScript's output for the case. The core reads no clock, so the script times the whole process from
/// outside.
#[test]
fn layering_timing_workload_runs() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_LAYERING_TIMING") else {
        return;
    };
    let repeats: u32 = std::env::var("GRAPH_LAYOUT_LAYERING_REPEATS")
        .expect("GRAPH_LAYOUT_LAYERING_REPEATS is set with the workload")
        .parse()
        .expect("GRAPH_LAYOUT_LAYERING_REPEATS is a count");
    let text = std::fs::read_to_string(&path).expect("the timing workload is readable");
    let cases = parse(&text);
    assert_eq!(cases.len(), 1, "a timing workload holds one case");
    let case = &cases[0];
    let mut scratch = Scratch::default();
    // The first run must give TypeScript's answer, so that the timed runs are the same computation.
    let first = run(case, &mut scratch);
    assert!(
        same_bits(&first.ranks, &case.expected.ranks)
            && first.reversed == case.expected.reversed
            && first.chains == case.expected.chains,
        "the timing workload {} differs from TypeScript",
        case.name
    );
    for _ in 0..repeats {
        std::hint::black_box(rank_and_layer(case, &mut scratch));
    }
}
