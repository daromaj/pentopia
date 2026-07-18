/**
 * Pentopia test fixtures - vendored from robx/pzprjs
 * Source: https://github.com/robx/pzprjs/blob/master/test/script/pentopia.js
 * License: MIT (https://github.com/robx/pzprjs)
 *
 * These fixtures contain one board per validator failcode plus valid boards,
 * extracted from the pzprjs test harness as ground truth for our validator tests.
 */

export interface PentopiaFixture {
  name: string;
  failcode: string | null;
  pzprv3: string;
}

export const fixtures: PentopiaFixture[] = [
  {
    name: "csOnArrow",
    failcode: "csOnArrow",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. . . . . . . /. # # . . . . /. . # . . . . /. . # . . . . /. . . . . . . /. . . . . . . /0 0 0 0 0 /"
  },
  {
    name: "arNoShade",
    failcode: "arNoShade",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. . . . . . . /. . . . . . . /. . . . . # . /. . . . . # # /. . . . . . # /. . . . . . . /0 0 0 0 0 /"
  },
  {
    name: "bankInvalid",
    failcode: "bankInvalid",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. . # # . . . /. . . . . . . /. . . . . # . /. # . . . # # /. # # # . . # /. . . # . . . /0 0 0 0 0 /"
  },
  {
    name: "shDiag",
    failcode: "shDiag",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. # # # . . . /. . . # . . . /. . . . # # . /. . . # # . . /. . . . . . . /. . . . . . . /0 0 0 0 0 /"
  },
  {
    name: "bankGt",
    failcode: "bankGt",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. . . . . . . /. . . . . . . /. . . . . # . /. . . . . # # /. # # . . . # /. . # # . . . /0 0 0 0 0 /"
  },
  {
    name: "arDistanceGt",
    failcode: "arDistanceGt",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. # # . . . . /. # . . . . . /. # . . . . . /. . . . . . . /. . . . . . . /. . . . . . . /0 0 0 0 0 /"
  },
  {
    name: "arDistanceNe",
    failcode: "arDistanceNe",
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /. . . . # . . /. . . . # # # /. . . . . . . /. . . . . . . /. . . . . . . /. . . . . . . /0 0 0 0 0 /"
  },
  {
    name: "arNoShade_5x5",
    failcode: "arNoShade",
    pzprv3: "pzprv3/pentopia/5/5/p/t/. . . . . /. . . . . /. . 5 . . /. . . . . /. . . . . /. . . . . /. . . . . /. # # . . /# # . . . /# . . . . /0 0 0 0 0 0 0 0 0 0 0 0 /"
  },
  {
    name: "arDistanceGt_5x5",
    failcode: "arDistanceGt",
    pzprv3: "pzprv3/pentopia/5/5/p/t/. . . . . /. . . . . /. . 5 . . /. . . . . /. . . . . /. . . . . /. . . . . /# # # # # /. . . . . /. . . . . /0 0 0 0 0 0 0 0 0 0 0 0 /"
  },
  {
    name: "arDistanceNe_5x5",
    failcode: "arDistanceNe",
    pzprv3: "pzprv3/pentopia/5/5/p/t/. . . . . /. . . . . /. . 5 . . /. . . . . /. . . . . /. # # # # /. . . . # /# # # . . /# . . . . /# . . . . /0 0 0 0 0 0 0 0 0 0 0 0 /"
  },
  {
    name: "valid_5x5",
    failcode: null,
    pzprv3: "pzprv3/pentopia/5/5/p/t/. . . . . /. . . . . /. . 5 . . /. . . . . /. . . . . /. . . . . /. . # # . /. # # . . /. # . . . /. . . . . /0 0 0 0 0 0 0 0 0 0 0 0 /"
  },
  {
    name: "valid_6x7",
    failcode: null,
    pzprv3: "pzprv3/pentopia/6/7/t/. . . . . . 6 /. . . . . . . /. . 3 11 . . . /8 . . . . . . /. . . . . 9 . /. . . . . 5 . /+ # # # + + + /+ # + + + + + /+ + + + + # + /+ + + + + # # /+ + # # + + # /+ + # # + + + /0 0 0 0 0 /"
  }
];
