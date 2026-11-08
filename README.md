# 鸣潮终焉矩阵血线排布 V0.1

已完成前期玩法调研、头像下载、原始分数表导入，以及可交互的血线排布 Demo。

## V0.1 Windows 便携版

解压 `WuwaMatrixPlanner-v0.1.0-win-x64.zip`，双击“终焉矩阵血线排布.exe”。便携包包含 Node.js 运行时和全部可用本地素材，无需另装 Node.js 或 Python；程序优先通过本机 Edge、其次 Chrome 打开独立应用窗口。右键系统托盘图标选择“退出软件”会停止服务。

正式版窗口与之前 Demo 的浏览器存储彼此独立。迁移原有排布时，请先在 Demo 导出 JSON，再在 V0.1 导入；建议保留 JSON 备份。默认监听本机 4174 端口，已启动时会复用同一服务。

版本说明见 [CHANGELOG.md](CHANGELOG.md)，素材来源与运行时许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 运行 Demo

双击 `启动Demo.cmd` 即可启动并打开浏览器。启动脚本会依次查找系统 Node.js、本项目运行时和本机 Codex 自带的 Node.js，不要求 Node.js 已加入系统 PATH；无需安装 npm 依赖。服务仅监听本机地址，已启动时会复用同一服务。也可直接运行 `node server.mjs` 后打开 `http://127.0.0.1:4173`。

1. 左侧选择“体力期数”后新建队伍，在同一个窗口填写分数、选择 3 个角色，队名按选人顺序取每个角色首字自动生成，例如“相里要＋吟霖＋卡提希娅”生成“相吟卡”；可手动改名，手动名称不会被换人覆盖。清空队名恢复自动命名。编辑和取消均保留原有保存逻辑。
2. 所有队伍在同一条轴上依次排列，分数决定色条长度。悬停色条可查看阵容、分数、累计积分、起止剩余百分比和当前 Boss 剩余可得分数；下方详情同步显示。剩余分数包含尚未获得的击杀奖励。双击色条或选中后按 Enter，直接打开该队的编辑窗口。
3. 第一队始终从 0 分开始，后续队伍自动首尾相接；改分或删队时同步重排。起点累计积分自动计算，不可独立修改。
4. 拖动色条改变队伍顺序，插入标记显示目标位置，松开后吸附；也可用左右方向键前移、后移一位。横向滚动查看后续 Boss，也可调整缩放与显示轮次。每个 Boss 标签均使用“R轮次＋官方名称”，例如“R2 燎照之骑”。
5. 右上角导入、导出 JSON。当前配置也会自动保存在本浏览器。
6. 在“目标总分”输入位置（支持 0 和小数），点击“定位并标记”，自动展开所需轮次、滚动至该位置并显示标记及对应 Boss。标记随缩放和队伍改动保留，保存到 JSON 的 `scoreMarker` 字段；可清除，超出 R15 已配置数据范围的目标会提示错误。目标落入矩阵奇藏奖励区时会明确标注。
7. 点击“快捷组队”直接连续选人：第 1—3 位组成一队，第 4—6 位组成下一队，依次接在现有队伍之后。无需填写队名或分数，队名自动生成；新队标为“待填分数”，显示在待填区域，可双击补分后进入积分轴，不虚构伤害得分。最后不足 3 人时须补齐再加入。

快捷组队中的“撤回”“恢复”按选人步骤操作；“重置”只清空本次草稿，并且可以撤回。撤回后重新选人会替换原恢复分支；取消或关闭窗口不修改现有队伍。也可在非输入框中按 Ctrl+Z、Ctrl+Y（或 Ctrl+Shift+Z）。快捷选人照常计算已有队伍和本次新增队伍消耗的角色体力，同队不能重复角色，2 体角色可进入两支队伍。

待填分数队伍在 JSON 中保存为 `score: 0, needsScore: true`，仍保留真实队伍顺序和阵容。填入正数后移除 `needsScore` 状态，生成对应血线长度。

缩放范围现为每积分 0.000001—0.24 像素，缩小可看到更多队伍，放大可查看细节。“全部队伍”按已排队伍总分适配视野；“全部血线”展开至 R15 并适配全部 75 段 Boss（42 段原表、33 段推算）。积分刻度随缩放和滚动按当前视野绘制，避免高轮次产生大量无用节点。

`config/demo.json` 为初始配置，字段包括 `version`、`towerId`、`staminaSeason`、`maxRound`、`pixelsPerPoint`、`teams`；每支队伍保存 `id`、`name`、3 个 `characterIds`、`score`、`startScore` 和 `color`。`teams` 数组决定出场顺序，导入时自动重算连续的 `startScore`，并检查角色体力上限。同队内仍不能重复选同一角色。旧浏览器配置中合法的多次上阵会保留，只有超出体力的角色会清理为待补选状态（`needsCharacters: true`）；队伍和分数保留。缩放低于 0.000001 的配置会自动抬高到新下限。自动命名队伍保存 `nameMode: "auto"`，手动命名保存 `nameMode: "custom"`。

Demo 采用 JavaScript、HTML、CSS，Node.js 仅提供本地静态文件服务。当前血线仍展示 `/newtower/16` 本期，从 R1 起；原表 R9 仅有前两只 Boss，切换体力期数不会把本期分数表套用到下一期。矩阵奇藏的额外 1000 分单独画为斜纹奖励段。尚未加入自动最优排队。

`config/stamina.json` 保存体力规则：普通角色 1 体；守岸人、维里奈、白芷、卜灵、莫宁、穗穗基础 2 体。本期琳奈额外 +1 体，下期洛瑟菈额外 +1 体。界面显示“剩余/总量”，体力根据已进入的队伍数量计算；编辑时排除本队，删除或换下角色后自动释放体力。若临时加成与基础 2 体重合，将按相加计算。切换期数会先检查现有阵容，超出上限则提示调整并保留原配置。漂泊者各条目共享使用次数。

运行 `node --test tests/score-axis.test.mjs` 可验证 75 段 Boss 的血线换算、来源标记、边界和 JSON 配置；运行 `python -m unittest discover -s tests -v` 可校验原表保留及推算规则。

当前保留角色头像 58 张，以及本期 `/newtower/16`、下一期 `/newtower/18` 的 Boss 素材，两期各 5 个 Boss，去重后共 8 张。普通怪物头像已删除。角色索引仍保留 65 条记录；莉莉头像原站返回 404。

- [玩法与计分规则](docs/终焉矩阵调研与计分规则.md)
- `data/characters.json`、`data/bosses.json`：带来源、中文名称和本地路径的头像索引。
- `data/bosses_16.json`、`data/bosses_18.json`：按本期、下一期分别保存的 Boss 顺序和素材清单。
- `assets/`：本地 WebP 原图。
- `assets/elements/`、`data/elements.json`：从 Nanoka 下载的六种属性原图及来源、尺寸、哈希清单，可用 `tools/download_elements.py` 更新。
- `data/scores_source.json`：原表 42 条公式、参数和缓存值，保持原样。
- `data/scores.json`：42 条原表记录与 33 条推算记录，以及累计积分和拟合核验结果。
- `config/progression.json`：高轮次递增规则和 R15 截止；可运行 `python tools/extend_scores.py` 重建。
- `score_core.py`：未取整的计分/血线转换函数。
- `data/raw/`：原始表格快照与网站公开数据。

```powershell
python tools/import_scores.py "path/to/boss分数.xlsx"
python -m unittest discover -s tests -v
```

更新网站素材时，先运行 `tools/inspect_nanoka.py` 获取页面公开数据，再运行 `tools/download_assets.py` 下载并核验头像。下载脚本需要 Pillow；当前针对网站 3.8.3 数据，不会自动切换版本。已存在的图片会校验后复用。

下载脚本默认只更新两期 Boss，复用已有角色头像。仅在明确需要时，使用 `--include-monsters` 重新下载普通怪物头像；使用 `--refresh-characters` 重新检查角色头像。飞廉之猩、达妮娅的矩阵横图地址失效，目前使用同站图鉴中对应 Boss 的头像，并在清单中保留失效地址和替代图来源。下一期暂未套用本期血量与分数表。

`points_between_hp(wave, 0.8, 0.3)` 表示从 80% 血量打到 30% 所得积分。宝箱击杀额外 1000 分、取整方式未实测，以及推算数据来源等边界详见规则文档。

## 高轮次推算

已对原表 R4—R9 前两只共 27 条公式逐条核对，均符合连续波次的线性增长：

```text
n = 5 × (R - 4) + Boss在该轮的位次（1—5）
递增系数 = 1 + 0.05 × n
推算总血量 = 19,388,951 × 递增系数
普通Boss满分 = 推算总血量 / 1200 × 1.25
矩阵奇藏满分 = 推算总血量 / 1200 × 1.25 × 1.1 + 1000
```

每只增加的是 R3 基准的 5%，并非上一只再乘 1.05；每跨一整轮，同一 Boss 的系数增加 0.25。R9 后三只系数为 2.40、2.45、2.50；R10 五只依次为 2.55—2.75。

推算延伸到 R15（按用户指定的上限）。原始 42 条记录完全保留；R9 后三只及 R10—R15 新增 33 条均设 `estimated: true`，不是游戏内实测数据。所有推算段在轮次选项、Boss 标签、悬停说明、定位结果中标明。推算血量采用将原表递增项视作血量增长的解释，精确计分与取整仍以游戏实测为准。

## 源码与构建

源码使用 JavaScript/HTML/CSS；Windows 启动器为 C#，使用系统 .NET Framework 4 编译器构建。源码仓库不包含便携包二进制、浏览器测试输出、个人排布文件及原始网页快照。

```powershell
npm test
python -m unittest discover -s tests -v
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build_release.ps1 -NodeExe "path/to/node.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File tools/test_release.ps1
```

构建会生成 Windows x64 便携目录、ZIP、SHA-256 校验文件。源码中的 `desktop/LICENSE.node.txt` 对应打包运行时 Node.js v24.22.1。头像下载脚本需要 Python 和 Pillow，日常使用软件不需要这些开发依赖。
