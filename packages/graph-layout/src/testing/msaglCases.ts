// Test-only: inequality cases ported from MSAGL's ProjectionSolverTests.cs (MIT, Microsoft; GraphLayout/Test/MSAGLTests/Constraints/ProjectionSolverTests.cs, master). Only the inequality cases are ported. The equality cases (Test1_Equality_Push and _Pull, Test_Equality_*, the Qpsc and Scale cases, and the MoveMidVarsToSegmentEnds cases) are skipped: the engine has no equality separations. Test2_Neighbors is skipped too, since its NeighborDef term is a quadratic pair penalty that solveSeparations does not model.

/** One ported case: desired positions and weights, separations (from, to, gap) meaning x[to] - x[from] >= gap. */
export interface Case {
  name: string;
  desired: number[];
  weight?: number[];
  seps: [number, number, number][];
  expected: number[];
  goal?: number;
}

export const chain3 = [
  [0, 1, 3],
  [1, 2, 3],
] as [number, number, number][];

/** The five-variable graph of Test1 and its weighted variant: a 0-4 span, a 0-1-2 path and 3 below 4. */
export const test1Seps = [
  [0, 4, 3],
  [0, 1, 3],
  [1, 2, 3],
  [2, 4, 3],
  [3, 4, 3],
] as [number, number, number][];

export const cases: Case[] = [
  {
    name: "Test1 (simple solver)",
    desired: [2, 9, 9, 9, 2],
    seps: test1Seps,
    expected: [1.4, 4.4, 7.4, 7.4, 10.4],
  },
  {
    name: "Test2 (simple solver)",
    desired: [4, 6, 9, 2, 5],
    seps: [
      [0, 2, 3],
      [0, 3, 3],
      [1, 4, 3],
      [2, 4, 3],
      [2, 3, 3],
      [3, 4, 3],
    ],
    expected: [0.5, 6, 3.5, 6.5, 9.5],
  },
  {
    name: "Test3 (simple solver)",
    desired: [5, 6, 7, 4, 3],
    seps: [
      [0, 4, 3],
      [1, 2, 3],
      [2, 3, 3],
      [2, 4, 3],
      [3, 4, 3],
    ],
    expected: [5, 0.5, 3.5, 6.5, 9.5],
  },
  {
    name: "Test4 (simple solver)",
    desired: [7, 1, 6, 0, 2],
    seps: [
      [0, 3, 3],
      [0, 1, 3],
      [1, 4, 3],
      [2, 4, 3],
      [2, 3, 3],
      [3, 4, 3],
    ],
    expected: [0.8, 3.8, 0.8, 3.8, 6.8],
  },
  {
    name: "Test5 (ten variables, a repeated separation)",
    desired: [0, 9, 1, 9, 5, 1, 2, 1, 6, 3],
    seps: [
      [0, 3, 3],
      [1, 8, 3],
      [1, 6, 3],
      [2, 6, 3],
      [3, 5, 3],
      [3, 6, 3],
      [3, 7, 3],
      [4, 8, 3],
      [4, 7, 3],
      [5, 8, 3],
      [5, 7, 3],
      [5, 8, 3],
      [6, 9, 3],
      [7, 8, 3],
      [7, 9, 3],
      [8, 9, 3],
    ],
    expected: [
      -3.71429, 4, 1, -0.714286, 2.28571, 2.28571, 7, 5.28571, 8.28571, 11.2857,
    ],
  },
  {
    name: "Test6 (a repeated separation)",
    desired: [7, 0, 3, 1, 4],
    seps: [
      [0, 3, 3],
      [0, 2, 3],
      [1, 4, 3],
      [1, 4, 3],
      [2, 3, 3],
      [3, 4, 3],
    ],
    expected: [-0.75, 0, 2.25, 5.25, 8.25],
  },
  {
    name: "Test7 (simple solver)",
    desired: [4, 2, 3, 1, 8],
    seps: [
      [0, 4, 3],
      [0, 2, 3],
      [1, 3, 3],
      [2, 3, 3],
      [2, 4, 3],
      [3, 4, 3],
    ],
    expected: [-0.5, 2, 2.5, 5.5, 8.5],
  },
  {
    name: "Test8 (simple solver)",
    desired: [3, 4, 0, 5, 6],
    seps: [
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
      [1, 4, 3],
      [2, 3, 3],
      [2, 3, 3],
      [3, 4, 3],
      [3, 4, 3],
    ],
    expected: [-2.4, 0.6, 3.6, 6.6, 9.6],
  },
  {
    name: "Test9 (simple solver)",
    desired: [8, 2, 6, 5, 3],
    seps: [
      [0, 4, 3],
      [0, 3, 3],
      [1, 2, 3],
      [1, 4, 3],
      [2, 3, 3],
      [2, 4, 3],
      [3, 4, 3],
    ],
    expected: [3.6, 0.6, 3.6, 6.6, 9.6],
  },
  {
    name: "Test13 (fractional desired positions, repeated separations)",
    desired: [0.485024, 3.52714, 4.01263, 4.58524, 5.40796],
    seps: [
      [0, 4, 3],
      [0, 4, 3],
      [0, 4, 3],
      [0, 2, 3],
      [1, 3, 3],
      [1, 3, 3],
      [1, 2, 3],
      [2, 4, 3],
      [2, 4, 3],
      [2, 4, 3],
      [2, 3, 3],
      [3, 4, 3],
      [3, 4, 3],
      [3, 4, 3],
    ],
    expected: [0.0035988, 0.0035988, 3.0036, 6.0036, 9.0036],
  },
];
