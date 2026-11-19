# 第三方资源说明

本工具为玩家使用的非官方排布程序，与《鸣潮》开发商、发行商无隶属关系。

## 图像及游戏资料

角色头像、Boss 图片、属性图标、回路图标和关卡资料均为《鸣潮》的游戏素材与内容。素材获取地址、文件哈希及来源记录保存在 `data/` 清单中。相关图像、名称和游戏资料的权利归原权利人，本项目不主张这些资源的著作权。

分数以用户提供的最新血量和整数分数表为基础；高轮次推算明确标注，具体规则见 `data/s2_4_score_source.json` 及规则说明。

漂泊者组合头像由原男女头像制作并经作者确认，用于合并同属性的性别选项；相关游戏人物与原素材的权利仍归原权利人。

莉莉头像由作者提供的角色介绍图片抠图制作，文件为 `assets/characters/Lily_UserPortrait_v1.png`，来源说明与哈希保存在角色清单中。相关游戏人物与原素材的权利仍归原权利人。

## 椰果工具箱

本软件集成 D4RK（d4rkOfficial）开发的椰果工具箱计算引擎及其 fast-calc 页面作为代码的一部分，基于提交 `441852a7626f06dcd8b62206767fc1420c4e21a9`。本项目适配了离线资料、旧版工程的链阶条件及逐击数据传递。原项目采用 MIT 许可证，便携包与源码均附带原版权声明、许可全文、免责声明和原作者的补充声明。[上游源码](https://github.com/d4rkOfficial/wuwa-afyg-tool/tree/441852a7626f06dcd8b62206767fc1420c4e21a9) · [许可证](afyg-replay/LICENSE.txt)

## Node.js

Windows 便携版附带 Node.js v24.22.1 Windows x64 运行时，源项目为 [nodejs/node](https://github.com/nodejs/node)。完整许可证随便携包放在 `runtime/LICENSE.node.txt`，包含其第三方依赖的通知。

浏览器运行时由用户本机的 Microsoft Edge、Google Chrome 或默认浏览器提供，未随包分发。
