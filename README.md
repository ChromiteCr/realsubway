# realsubway

北京地铁规划模拟游戏(纯前端,无服务器)。灵感来自 [Brand New Subway](https://jpwright.github.io/subway/) 与 [Subway Builder](https://www.subwaybuilder.com),目标是在真实北京地图上画线建站,模拟一个运营日的出行(首末班车、逐小时班次、A/B/C 车型编组),并以 **运输总量 / 经济利润 / 综合评分** 三参数评价线网。

## 开发

```bash
npm install
npm run dev        # 开发服务器 (端口 5180)
npm test           # vitest 单元测试
npm run typecheck  # tsc --noEmit
npm run build      # 产物可静态托管(如 GitHub Pages)
```

## 结构

```
tools/        Python 离线数据管线(人口/吸引栅格、现网数据)——待建
src/model/    线网数据模型(站/线/服务计划/车型)
src/sim/      模拟引擎,跑在 Web Worker(需求→OD→分配→评价)——待建
src/render/   MapLibre GL 图层(线网、列车、热力)
src/ui/       线路面板、车站弹窗、日报
src/persist/  localStorage 自动存档 + JSON 导入导出
```

## 路线图

- [x] **M1 画线建站**:地图上建站、铺线、并线换乘、改名删除;自动存档与导入导出
- [ ] **M2 静态客流**:人口/吸引栅格 + 引力模型 OD + 最短路分配 → 运输总量
- [ ] **M3 时间维度**:服务计划编辑器(首末班车/逐小时间隔/车型编组)、模拟时钟、列车动画、容量约束
- [ ] **M4 经济与评分**:票款/运营成本/建设摊销;三参数日报;以真实北京现网标定评分
- [ ] **M5 打磨**:开局模式(空白/现网)、需求热力图、性能压测

完整设计见项目发起时的设计文档(计划文件)。
