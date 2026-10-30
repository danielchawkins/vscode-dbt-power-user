//! Effort budgets as iteration counts, never clock time: `Budget` and the table of `budget.ts`. The fixture in
//! `fixtures/parity` is printed by `scripts/parity/print-fixtures.mjs`.

/// The work counts one run may spend. Every count is a cap: reaching it stops that search early, and no count changes
/// what a search would choose before it stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Budget {
    /// Pivot cap of the rank network simplex. Every pivot keeps the ranks feasible.
    pub rank_pivots: usize,
    /// Order sweeps, each a median or barycentre pass with transposition.
    pub sweeps: usize,
    /// Sifting passes after the sweeps of each search. Zero skips sifting.
    pub sift_rounds: usize,
    /// Sifting passes over the dummies alone, before each search, so that each dummy starts in a good place.
    pub dummy_sift_rounds: usize,
    /// Dummy sifting passes for the hinted order; sifting stops early once a pass moves nothing.
    pub hinted_dummy_sift_rounds: usize,
    /// Seeded restarts from shuffled starting orders, beyond the hinted or depth-first start.
    pub restarts: usize,
    /// Gradient-projection iterations of the placement solve. At zero, the Brandes and Köpf coordinates are the answer.
    pub place_iterations: usize,
    /// Overlapping pairs of hyperedges examined in one routing. Past it, tracks keep left-edge order only.
    pub route_pairs: usize,
    /// Piece pairs a band's doglegs may test.
    pub dogleg_work: usize,
}

const FAST: Budget = Budget {
    rank_pivots: 1_000,
    sweeps: 4,
    sift_rounds: 0,
    dummy_sift_rounds: 3,
    hinted_dummy_sift_rounds: 12,
    restarts: 0,
    place_iterations: 0,
    route_pairs: 100_000,
    dogleg_work: 20_000,
};

const BALANCED: Budget = Budget {
    rank_pivots: 10_000,
    sweeps: 12,
    sift_rounds: 3,
    dummy_sift_rounds: 3,
    hinted_dummy_sift_rounds: 12,
    restarts: 0,
    place_iterations: 100,
    route_pairs: 1_000_000,
    dogleg_work: 200_000,
};

const THOROUGH: Budget = Budget {
    rank_pivots: 100_000,
    sweeps: 24,
    sift_rounds: 3,
    dummy_sift_rounds: 3,
    hinted_dummy_sift_rounds: 12,
    restarts: 8,
    place_iterations: 500,
    route_pairs: 4_000_000,
    dogleg_work: 1_000_000,
};

impl Budget {
    /// The budget `budgetOf` gives for `effort`: `balanced` when `effort` is `None`, as `budgetOf` defaults it. A name
    /// that is not an effort gives `None`, where the TypeScript table lookup gives `undefined`.
    #[must_use]
    pub(crate) fn for_effort(effort: Option<&str>) -> Option<Self> {
        match effort {
            None | Some("balanced") => Some(BALANCED),
            Some("fast") => Some(FAST),
            Some("thorough") => Some(THOROUGH),
            Some(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The budgets of `budgetOf` in `budget.ts`, printed by `scripts/parity/print-fixtures.mjs budget`: one line per
    /// effort, `budget <effort> <field>=<count>...`, with `unset` for an options object without an effort.
    const BUDGET: &str = include_str!("../../fixtures/parity/budget.txt");

    /// Every count of `budget`, named as the TypeScript fields are.
    fn counts(budget: &Budget) -> [(&'static str, usize); 9] {
        [
            ("rankPivots", budget.rank_pivots),
            ("sweeps", budget.sweeps),
            ("siftRounds", budget.sift_rounds),
            ("dummySiftRounds", budget.dummy_sift_rounds),
            ("hintedDummySiftRounds", budget.hinted_dummy_sift_rounds),
            ("restarts", budget.restarts),
            ("placeIterations", budget.place_iterations),
            ("routePairs", budget.route_pairs),
            ("doglegWork", budget.dogleg_work),
        ]
    }

    #[test]
    fn every_effort_matches_the_typescript_fixture_exactly() {
        let mut checked = 0;
        for line in BUDGET.lines().filter(|line| line.starts_with("budget ")) {
            let fields: Vec<&str> = line.split(' ').collect();
            let effort = match fields[1] {
                "unset" => None,
                name => Some(name),
            };
            let budget = Budget::for_effort(effort).expect("a fixture effort is a known effort");
            let expected: Vec<String> = fields[2..]
                .iter()
                .map(|field| (*field).to_owned())
                .collect();
            let actual: Vec<String> = counts(&budget)
                .iter()
                .map(|(name, count)| format!("{name}={count}"))
                .collect();
            assert_eq!(actual, expected, "effort {effort:?}");
            checked += 1;
        }
        assert_eq!(
            checked, 4,
            "every effort and the unset default of the fixture is checked"
        );
    }

    #[test]
    fn an_unknown_effort_has_no_budget() {
        assert_eq!(Budget::for_effort(Some("slow")), None);
        assert_eq!(Budget::for_effort(Some("Fast")), None);
    }

    #[test]
    fn the_budgets_are_ordered_by_effort() {
        let fast = Budget::for_effort(Some("fast")).expect("fast");
        let balanced = Budget::for_effort(Some("balanced")).expect("balanced");
        let thorough = Budget::for_effort(Some("thorough")).expect("thorough");
        assert!(fast.sweeps < balanced.sweeps && balanced.sweeps < thorough.sweeps);
        assert!(
            fast.route_pairs < balanced.route_pairs && balanced.route_pairs < thorough.route_pairs
        );
    }
}
