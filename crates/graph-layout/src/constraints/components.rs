//! Strongly connected components of a directed graph, by Tarjan's algorithm, iterative so that a long chain cannot exhaust
//! the stack. Two vertices share a component exactly when each reaches the other. A port of `constraints/components.ts`.

/// The component of each vertex, numbered from zero in the order components complete.
pub(crate) fn components(count: usize, edges: &[(usize, usize)]) -> Vec<usize> {
    let mut adjacent: Vec<Vec<usize>> = vec![Vec::new(); count];
    for &(from, to) in edges {
        adjacent[from].push(to);
    }
    let mut walk = Walk {
        adjacent,
        index: vec![None; count],
        low: vec![0; count],
        open: vec![false; count],
        comp: vec![usize::MAX; count],
        stack: Vec::new(),
        next: 0,
        found: 0,
    };
    for v in 0..count {
        if walk.index[v].is_none() {
            walk.from(v);
        }
    }
    walk.comp
}

/// The state of one Tarjan pass: discovery indices, lowest reachable indices, and the stack of open vertices.
struct Walk {
    adjacent: Vec<Vec<usize>>,
    index: Vec<Option<usize>>,
    low: Vec<usize>,
    open: Vec<bool>,
    comp: Vec<usize>,
    stack: Vec<usize>,
    next: usize,
    found: usize,
}

impl Walk {
    /// Walks everything reachable from `root` that is not yet numbered.
    fn from(&mut self, root: usize) {
        let mut frames: Vec<(usize, usize)> = vec![(root, 0)];
        self.enter(root);
        while let Some(&(v, k)) = frames.last() {
            if k < self.adjacent[v].len() {
                if let Some(frame) = frames.last_mut() {
                    frame.1 = k + 1;
                }
                let w = self.adjacent[v][k];
                match self.index[w] {
                    None => {
                        self.enter(w);
                        frames.push((w, 0));
                    }
                    Some(iw) if self.open[w] => self.low[v] = self.low[v].min(iw),
                    Some(_) => {}
                }
                continue;
            }
            frames.pop();
            if let Some(&(parent, _)) = frames.last() {
                self.low[parent] = self.low[parent].min(self.low[v]);
            }
            if self.index[v] == Some(self.low[v]) {
                self.close(v);
            }
        }
    }

    fn enter(&mut self, v: usize) {
        self.index[v] = Some(self.next);
        self.low[v] = self.next;
        self.next += 1;
        self.stack.push(v);
        self.open[v] = true;
    }

    /// Pops the component whose root is `v`.
    fn close(&mut self, v: usize) {
        while let Some(w) = self.stack.pop() {
            self.open[w] = false;
            self.comp[w] = self.found;
            if w == v {
                break;
            }
        }
        self.found += 1;
    }
}
