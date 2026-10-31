//! Unit tests of the across helpers: the rank centres stack from the origin with the gaps between ranks, the rows take
//! their rank's centre, and the anchor finds its node.

use super::{across_layout, across_of_rows, anchor_index, rank_centres};

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

#[test]
fn the_rows_take_each_rank_half_as_its_widest_node_and_dummies_count_as_zero() {
    // Ranks 0 and 1: node 0 (extent 10) and node 1 (extent 4) share rank 0; node 2 (extent 6) is alone in rank 1; node
    // 3 is a dummy in rank 1 with no extent. Gap 6 between the ranks.
    let layout = across_layout(&[0, 0, 1, 1], 2, &[10.0, 4.0, 6.0, 0.0], &[6.0]);
    assert_eq!(layout.rank_half, vec![5.0, 3.0]);
    assert_eq!(layout.half, vec![5.0, 2.0, 3.0, 0.0]);
    // Rank 0 is centred on 5; rank 1 starts after 2 * 5 + 6 = 16 and is centred on 16 + 3 = 19.
    assert_eq!(layout.centres, vec![5.0, 19.0]);
}

#[test]
fn an_anchor_moves_its_rank_to_the_origin_and_no_anchor_keeps_the_rows() {
    let centres = [5.0, 19.0];
    let anchored = across_of_rows(&[0, 0, 1], &centres, Some(2));
    assert_eq!(anchored.shift, -19.0);
    assert_eq!(anchored.across, vec![-14.0, -14.0, 0.0]);
    let free = across_of_rows(&[0, 0, 1], &centres, None);
    assert_eq!(free.shift, 0.0);
    assert_eq!(free.across, vec![5.0, 5.0, 19.0]);
}

#[test]
fn the_anchor_is_the_first_node_with_its_id_and_a_dummy_never_matches() {
    let ids = [Some("a"), None, Some("b"), Some("a")];
    assert_eq!(anchor_index(&ids, Some("a")), Some(0));
    assert_eq!(anchor_index(&ids, Some("b")), Some(2));
    assert_eq!(anchor_index(&ids, Some("zz")), None);
    assert_eq!(anchor_index(&ids, None), None);
}
