// Test-only: the chain, weight, tree and negative-gap cases ported from MSAGL's ProjectionSolverTests.cs; see msaglCases.ts.
import { type Case, chain3, test1Seps } from "./msaglCases.js";

export const chainCases: Case[] = [
  {
    name: "Test_3_Vars (chain)",
    desired: [1, 1, 1],
    seps: chain3,
    expected: [-2, 1, 4],
  },
  {
    name: "Test_3_Vars_Weight (chain pulled by weight)",
    desired: [1, 1, 1],
    weight: [1, 10, 100],
    seps: chain3,
    expected: [-4.67568, -1.67568, 1.32432],
  },
  {
    name: "Test_4_Vars (chain)",
    desired: [1, 1, 1, 1],
    seps: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 3, 3],
    ],
    expected: [-3.5, -0.5, 2.5, 5.5],
  },
  {
    name: "Test_4_Vars_Weight (chain pulled by weight)",
    desired: [1, 1, 1, 1],
    weight: [1, 10, 100, 1000],
    seps: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 3, 3],
    ],
    expected: [-7.66787, -4.66787, -1.66787, 1.33213],
  },
  {
    name: "Test2_Reverse (separations run towards lower indices)",
    desired: [4, 6, 9, 2, 5],
    seps: [
      [2, 0, 3],
      [3, 0, 3],
      [4, 1, 3],
      [4, 2, 3],
      [3, 2, 3],
      [4, 3, 3],
    ],
    expected: [9.5, 6, 6.5, 3.5, 0.5],
  },
  {
    name: "Test2_NegativeGap (negative gaps)",
    desired: [4, 6, 9, 2, 5],
    seps: [
      [0, 2, -3],
      [0, 3, -3],
      [1, 4, -3],
      [2, 4, -3],
      [2, 3, -3],
      [3, 4, -3],
    ],
    expected: [4, 6, 7, 4, 5],
  },
  {
    name: "Test1_Weight4 (push and pull through weights)",
    desired: [2, 9, 9, 9, 2],
    weight: [4, 4, 4, 4, 4],
    seps: test1Seps,
    expected: [1.4, 4.4, 7.4, 7.4, 10.4],
  },
  {
    name: "Test1_Weight4_2 (lighter weights on the middle)",
    desired: [2, 9, 9, 9, 2],
    weight: [4, 4, 4, 2, 2],
    seps: test1Seps,
    expected: [2, 5.33333, 8.33333, 8.33333, 11.33333],
  },
  {
    name: "Test_Tree (a tree of separations)",
    desired: [0, 0, 0, 0, 0, 0],
    seps: [
      [0, 2, 3],
      [1, 2, 3],
      [2, 4, 3],
      [3, 4, 3],
      [2, 5, 3],
      [4, 5, 3],
    ],
    expected: [-3.5, -3.5, -0.5, -0.5, 2.5, 5.5],
    goal: 61.5,
  },
  {
    name: "Test_Tree2 (a tree with a branch from a root)",
    desired: [0, 0, 0, 0, 0, 0],
    seps: [
      [0, 2, 3],
      [1, 2, 3],
      [2, 4, 3],
      [3, 0, 3],
      [3, 1, 3],
      [2, 5, 3],
      [4, 5, 3],
    ],
    expected: [-2.5, -2.5, 0.5, -5.5, 3.5, 6.5],
    goal: 97.5,
  },
];
