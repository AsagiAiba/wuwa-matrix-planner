export function newerPackageVersion(fileName, current) {
  const match = /^WuwaMatrixPlanner-v(\d{1,6}\.\d{1,6}\.\d{1,6})-win-x64(?: \(\d+\))?\.zip$/i.exec(fileName);
  if (!match) throw Error('请选择发布页的 WuwaMatrixPlanner-v版本号-win-x64.zip 便携包。');
  const version = match[1];
  const installed = current.split('.').map(Number);
  const parts = version.split('.').map(Number);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] > installed[i]) return version;
    if (parts[i] < installed[i]) throw Error('包体版本 v' + version + ' 低于当前 v' + current + '，无法降级。');
  }
  throw Error('当前已是 v' + current + '，无需重复更新。');
}
