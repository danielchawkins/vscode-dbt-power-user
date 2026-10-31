//! Unit tests of the across helpers: the rank centres stack from the origin with the gaps between ranks.

use super::rank_centres;

#[test]
fn ranks_stack_from_the_origin_with_their_gaps() {
    // Rank 0 is 10 across (half 5), rank 1 is 4 across (half 2), with a gap of 6 between them.
    assert_eq!(
        rank_centres(&[5.0, 2.0], &[6.0]),
        vec![5.0, 5.0 + 5.0 + 6.0 + 2.0]
    );
}

#[test]
fn a_rank_past_the_gaps_has_no_gap_after_it() {
    assert_eq!(rank_centres(&[1.0, 1.0, 1.0], &[]), vec![1.0, 3.0, 5.0]);
}

#[test]
fn an_empty_drawing_has_no_centres() {
    assert_eq!(rank_centres(&[], &[4.0]), Vec::<f64>::new());
}
