//! The classes that lie on or between directed cycles of the separations: those left after repeatedly removing a class with
//! no incoming separation. Empty when the separations form a DAG. A port of `constraints/cycles.ts`.

use super::Constraint;

/// The classes left on or between cycles, in index order.
pub(crate) fn cyclic_classes(count: usize, separations: &[Constraint]) -> Vec<usize> {
    let mut indegree = vec![0_usize; count];
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); count];
    for s in separations {
        succ[s.from].push(s.to);
        indegree[s.to] += 1;
    }
    let mut queue: Vec<usize> = (0..count).filter(|&c| indegree[c] == 0).collect();
    let mut next = 0;
    while next < queue.len() {
        let c = queue[next];
        next += 1;
        for &to in &succ[c] {
            indegree[to] -= 1;
            if indegree[to] == 0 {
                queue.push(to);
            }
        }
    }
    (0..count).filter(|&c| indegree[c] > 0).collect()
}
