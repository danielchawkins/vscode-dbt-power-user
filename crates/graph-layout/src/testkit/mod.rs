//! Oracles and fixtures for the tests: exact crossings and separations, and the TypeScript frames.

pub(crate) mod crossings;
pub(crate) mod solve;

/// The TypeScript encodings of the golden inputs, printed by `scripts/parity/print-fixtures.mjs frame`: one line per
/// kind, `frame <kind> <hex>`.
const FRAMES: &str = include_str!("../../fixtures/parity/frame.txt");

/// The frame the fixture holds for `kind` (`graph`, `layout` or `empty-layout`), as bytes.
pub(crate) fn frame_fixture(kind: &str) -> Vec<u8> {
    let prefix = format!("frame {kind} ");
    let line = FRAMES
        .lines()
        .find_map(|line| line.strip_prefix(prefix.as_str()))
        .expect("the fixture holds the frame");
    line.as_bytes()
        .chunks(2)
        .map(|pair| {
            let digits = std::str::from_utf8(pair).expect("hex digits are ASCII");
            u8::from_str_radix(digits, 16).expect("a byte of hex")
        })
        .collect()
}
