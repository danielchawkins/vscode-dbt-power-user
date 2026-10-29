// lint-expect: oxlint eslint/no-delete-var
let v = 1;
function f() {
  delete v;
  return v;
}
module.exports = f;
