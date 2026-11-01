//! Stable FNV-1a 64 keys over canonical bytes: the phase cache keys of ADR 0011 (\"Live tuning\"). The hash is fixed by
//! its constants, not by the platform, so a key computed in one process matches the key of another.

const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

/// A streaming FNV-1a 64 hasher. Feeding the same bytes in any split gives the same key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Fnv64 {
    state: u64,
}

impl Fnv64 {
    /// A hasher that has read no bytes.
    #[must_use]
    pub(crate) const fn new() -> Self {
        Self {
            state: OFFSET_BASIS,
        }
    }

    /// Reads `bytes` into the hash, one byte at a time: xor, then multiply by the prime.
    pub(crate) fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.state ^= u64::from(byte);
            self.state = self.state.wrapping_mul(PRIME);
        }
    }

    /// Reads a `u32` as its four little-endian bytes, the canonical form of the key bytes.
    pub(crate) fn write_u32(&mut self, value: u32) {
        self.write(&value.to_le_bytes());
    }

    /// Reads an `f64` as the little-endian bytes of its bit pattern, so `-0.0` and `0.0` key apart and a `NaN` keys by its
    /// payload.
    pub(crate) fn write_f64(&mut self, value: f64) {
        self.write(&value.to_bits().to_le_bytes());
    }

    /// The key of the bytes read so far.
    #[must_use]
    pub(crate) const fn finish(self) -> u64 {
        self.state
    }
}

impl Default for Fnv64 {
    fn default() -> Self {
        Self::new()
    }
}

/// The FNV-1a 64 key of `bytes`.
#[cfg(test)]
#[must_use]
pub(crate) fn key_of(bytes: &[u8]) -> u64 {
    let mut hasher = Fnv64::new();
    hasher.write(bytes);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_is_the_offset_basis() {
        assert_eq!(key_of(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(Fnv64::new().finish(), 0xcbf2_9ce4_8422_2325);
    }

    #[test]
    fn known_answers_from_the_fnv_test_suite() {
        assert_eq!(key_of(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(key_of(b"foobar"), 0x8594_4171_f739_67e8);
    }

    #[test]
    fn a_split_stream_keys_as_its_whole() {
        let mut hasher = Fnv64::new();
        hasher.write(b"foo");
        hasher.write(b"bar");
        assert_eq!(hasher.finish(), key_of(b"foobar"));
    }

    #[test]
    fn u32_is_its_little_endian_bytes() {
        let mut by_value = Fnv64::default();
        by_value.write_u32(0x0102_0304);
        assert_eq!(by_value.finish(), key_of(&[4, 3, 2, 1]));
    }

    #[test]
    fn f64_keys_by_its_bit_pattern() {
        let mut zero = Fnv64::new();
        zero.write_f64(0.0);
        let mut negative_zero = Fnv64::new();
        negative_zero.write_f64(-0.0);
        assert_ne!(zero.finish(), negative_zero.finish());

        let mut one = Fnv64::new();
        one.write_f64(1.0);
        assert_eq!(one.finish(), key_of(&1.0_f64.to_bits().to_le_bytes()));
    }

    #[test]
    fn different_inputs_key_apart() {
        assert_ne!(key_of(b"ab"), key_of(b"xy"));
    }
}
