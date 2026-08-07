# 客运与航线模拟规格 v0.1

状态：初稿  
目标：为概念验证版提供可直接实现、可测试、可调参的客运与航线模拟规则。

## 1. 设计目标

模拟系统必须持续产生以下经营问题：

> 在需求、距离、成本、船型和竞争不断变化时，应该怎样连接这些星港？

系统应满足：

1. 玩家不需要安排单个班次，也不管理单名乘客。
2. 直达、经停和换乘服务都有合理使用场景。
3. 高频小船和低频大船可以服务不同市场。
4. 票价、时间、班次、换乘、舒适度、声誉和准点率都会影响选择。
5. 玩家能够解释客流变化，而不是只看到一个无法理解的利润数字。
6. 相同世界种子和相同玩家操作必须得到相同结果。

## 2. 时间、距离和货币单位

### 2.1 模拟时间

- 最小经营结算单位：1 游戏日。
- 一周：7 日。
- 一月：28 日，便于班次和财务比较。
- 一年：13 月，共 364 日。
- 船只在界面上连续移动，但客流、收入和大部分成本每天聚合结算一次。
- 玩家可以暂停，并使用 1 倍、4 倍和 16 倍速度。

第一版不模拟具体日期和季节，事件通过开始日、持续日和恢复日表达。

### 2.2 标准单位

- 航程：游戏距离单位 `DU`。
- 时间：小时。
- 金额：信用点 `Cr`。
- 燃料：标准燃料单位 `FU`。
- 需求：单程旅客数/日。

地图可以显示天文单位或光年，但内部计算统一使用 `DU`，避免真实尺度使数值难以平衡。

## 3. 世界交通图

交通图分为星港节点和航段边。

### 3.1 星港节点

每个星港至少包含：

```ts
type Starport = {
  id: string;
  systemId: string;
  name: string;
  population: number;       // 1-100 的相对指数
  economy: number;          // 0-100
  business: number;         // 0-100
  tourism: number;          // 0-100
  administration: number;   // 0-100
  portLevel: 1 | 2 | 3 | 4 | 5;
  dailyCapacity: number;    // 每日可处理到达或出发座位数
  fuelPrice: number;        // Cr/FU
  serviceFee: number;       // 每次停靠基础费用
};
```

`population` 是经过压缩的游戏指数，不直接代表真实人口。使用指数可以防止首都和殖民地之间相差数十亿倍而破坏平衡。

### 3.2 航行方式

第一版保留三种航行边：

| 方式 | 连接规则 | 优势 | 限制 |
| --- | --- | --- | --- |
| 亚光速 | 同一恒星系统内的合法港口对 | 便宜、灵活 | 慢，不允许跨恒星系统 |
| 曲速 | 船只航程内的任意星际港口对 | 可以直达 | 燃料昂贵，距离增长明显 |
| 超空间 | 只能沿预设超空间边 | 快且节能 | 受到网络拓扑和风暴影响 |

一条玩家航线可以包含不同航行方式，但船型必须支持对应方式。例如，一艘超空间班轮可以在系统内使用亚光速航行，再进入超空间边。

每个航段包含：

```ts
type TravelLeg = {
  fromPortId: string;
  toPortId: string;
  mode: "sublight" | "warp" | "hyperspace";
  distance: number;
  hazard: number;            // 0-1
  timeModifier: number;      // 默认 1
  fuelModifier: number;      // 默认 1
  isOpen: boolean;
};
```

概念验证版的世界航段默认可双向通行；只需保存一条边。后续加入航权、单向风暴或方向性超空间流时，再为航段增加方向限制。

## 4. 潜在客运需求

### 4.1 客群

```ts
type PassengerClass = "economy" | "business" | "premium";
```

- 经济旅客：价格敏感，可以接受低频和一次换乘。
- 商务旅客：时间、频率和准点率敏感。
- 高端旅客：偏好直达、舒适度和高声誉公司。

潜在需求表示“如果存在足够合适的服务，今天最多可能出行的人数”。它不保证全部转化为实际客流。

### 4.2 基础需求

港口 `i` 到港口 `j`、客群 `c` 的基础单程日需求：

```text
marketSize(i, j) = sqrt(population_i * population_j)

baseDemand(i, j, c) =
  classScale_c
  * marketSize(i, j)
  * affinity(i, j, c)
  * distanceDecay(referenceTime(i, j), c)
```

其中：

```text
distanceDecay(t, c) = 1 / (1 + (t / timeScale_c) ^ distancePower_c)
```

`referenceTime` 使用世界交通图中理论上最快的可达路径，不依赖当前任何公司的航线，防止玩家撤线后潜在需求本身也发生不合理变化。

首轮默认参数：

| 客群 | classScale | timeScale | distancePower |
| --- | ---: | ---: | ---: |
| 经济 | 0.85 | 72 小时 | 1.35 |
| 商务 | 0.22 | 48 小时 | 1.55 |
| 高端 | 0.08 | 60 小时 | 1.40 |

### 4.3 市场关联度

`affinity` 由港口属性计算，初始建议限制在 `0.35-2.50`：

```text
economyAffinity =
  0.50
  + 0.20 * economicLink
  + 0.20 * tourismLink
  + 0.10 * administrativeLink

businessAffinity =
  0.35
  + 0.45 * businessLink
  + 0.15 * economicLink
  + 0.05 * administrativeLink

premiumAffinity =
  0.30
  + 0.30 * tourismLink
  + 0.25 * businessLink
  + 0.15 * administrativeLink
```

所有 `Link` 都是 `0-1` 的归一化值，由两个港口相应属性的几何平均数计算。设计数据还可以为特定港口对设置手工倍率，例如首都—殖民地、行星—轨道站。

### 4.4 当日需求变化

```text
potentialDemandToday =
  baseDemand
  * eventMultiplier
  * marketGrowthMultiplier
  * deterministicVariation
```

- `eventMultiplier`：事件倍率，默认为 1。
- `marketGrowthMultiplier`：长期发展倍率，概念验证版默认为 1。
- `deterministicVariation`：使用世界种子生成的平滑变化，建议范围为 `0.92-1.08`。

变化必须是平滑的，不允许每天使用独立随机数造成无法解释的剧烈跳动。

## 5. 航线和自动班次

### 5.1 航线定义

```ts
type Route = {
  id: string;
  companyId: string;
  name: string;
  kind: "return" | "loop";
  stops: RouteStop[];
  shipTypeId: string;
  assignedShipIds: string[];
  pricingPolicy: PricingPolicy;
  active: boolean;
};

type RouteStop = {
  portId: string;
  stopType: "commercial" | "technical";
  minimumStopHours: number;
};
```

往返线只保存正向停靠顺序。例如玩家输入 `A → B → C`，系统生成完整周期：

```text
A → B → C → B → A
```

环线 `A → B → C → D` 自动生成：

```text
A → B → C → D → A
```

技术停靠不允许乘客上下船，但会消耗港口容量和停靠费用。

### 5.2 航段时间

```text
travelHours =
  distance
  / effectiveSpeed(ship, mode)
  * leg.timeModifier
  * reliabilityDelayModifier
```

单次停靠时间：

```text
stopHours = max(
  minimumStopHours,
  baseTurnaroundHours(ship),
  refuelHours,
  congestionDelayHours
)
```

完整周转时间：

```text
cycleHours = sum(travelHours) + sum(stopHours) + maintenanceAllowance
```

### 5.3 自动班次与运力

每艘船连续执行完整周期，不要求玩家安排时刻表。

```text
cyclesPerWeek = assignedAvailableShips * 168 / cycleHours

departuresPerWeekOnEachCycleLeg = cyclesPerWeek

weeklySeatCapacityOnLeg =
  departuresPerWeekOnEachCycleLeg
  * shipSeats
  * operationalAvailability
```

平均班次间隔：

```text
headwayHours = 168 / departuresPerWeek
```

乘客预计平均等待时间：

```text
expectedWaitHours = min(headwayHours / 2, 96)
```

若不足一艘船可以完成计划周期，航线仍可运行，但班次间隔可能大于一周。

## 6. 可选行程生成

每天为有潜在需求的港口对生成可选行程。行程可以包含一家或多家公司的服务。

第一版限制：

- 最多 3 个商业航段。
- 最多 2 次换乘。
- 总旅行时间不得超过理论最快路径的 3 倍。
- 每个港口对、每类旅客最多保留 12 个候选行程。
- 使用带约束的 K 最短路径算法生成候选行程。
- 完全相同的公司、停靠序列和航行方式只保留综合成本最低者。

一次行程包含：

```ts
type JourneyOption = {
  originPortId: string;
  destinationPortId: string;
  passengerClass: PassengerClass;
  serviceLegIds: string[];
  companies: string[];
  fare: number;
  inVehicleHours: number;
  expectedWaitHours: number;
  transferHours: number;
  transferCount: number;
  comfort: number;           // 0-100，按在途时间加权
  reputation: number;        // 0-100，按航段加权
  onTimeRate: number;        // 0-1
};
```

同一艘船上的中途停靠不是换乘，但停靠时间计入总旅行时间。

## 7. 票价

航线设置基础价格策略，系统按实际乘坐航段计算票价。

```text
segmentFare =
  boardingFee
  + distance * ratePerDistance
  + travelHours * ratePerHour

finalSegmentFare =
  segmentFare
  * routePriceMultiplier
  * passengerClassMultiplier
  * eventPriceModifier
```

首轮建议允许玩家设置：

- 低价：`0.75`
- 标准：`1.00`
- 高价：`1.30`
- 自定义：`0.50-2.00`

不同客群可以有不同价格倍率，但第一版不单独模拟客舱。三类旅客共享物理座位。

## 8. 乘客选择模型

### 8.1 归一化指标

对于港口对 `i → j` 和客群 `c`：

```text
normalizedFare = journeyFare / acceptableFare(i, j, c)
normalizedTime = totalJourneyHours / referenceTime(i, j)
normalizedWait = expectedWaitHours / 24
normalizedComfortLoss = 1 - comfort / 100
normalizedReputationLoss = 1 - reputation / 100
normalizedDelayRisk = 1 - onTimeRate
```

### 8.2 广义成本

```text
generalizedCost =
  fareWeight_c * normalizedFare
  + timeWeight_c * normalizedTime
  + waitWeight_c * normalizedWait
  + transferWeight_c * transferCount
  + comfortWeight_c * normalizedComfortLoss
  + reputationWeight_c * normalizedReputationLoss
  + reliabilityWeight_c * normalizedDelayRisk
```

首轮默认权重：

| 客群 | 票价 | 时间 | 等待 | 换乘 | 舒适 | 声誉 | 准点 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 经济 | 4.0 | 1.2 | 0.6 | 0.8 | 0.3 | 0.3 | 0.5 |
| 商务 | 1.2 | 3.0 | 1.8 | 1.5 | 0.5 | 0.8 | 1.5 |
| 高端 | 0.8 | 2.0 | 0.8 | 2.0 | 1.8 | 1.5 | 1.2 |

### 8.3 市场份额

每个候选行程的吸引力：

```text
attractiveness(option) = exp(-generalizedCost / choiceTemperature_c)
```

同时加入“不出行”选项：

```text
noTravelAttractiveness = exp(-noTravelCost_c / choiceTemperature_c)
```

行程的初始需求份额：

```text
share(option) =
  attractiveness(option)
  / (noTravelAttractiveness + sum(all option attractiveness))
```

```text
requestedPassengers(option) = potentialDemandToday * share(option)
```

首轮默认值：

| 客群 | choiceTemperature | noTravelCost |
| --- | ---: | ---: |
| 经济 | 0.75 | 6.2 |
| 商务 | 0.60 | 7.0 |
| 高端 | 0.65 | 6.8 |

这些参数只是校准起点，必须通过自动化情景测试调整。

## 9. 运力约束和溢出需求

候选行程共享实际航段座位，因此不能分别假定都有完整运力。

每日分配过程：

1. 按选择模型计算所有港口对和客群的无约束需求。
2. 汇总每个服务航段上的请求座位数。
3. 若请求量超过航段剩余座位，所有使用该航段的请求按比例缩减。
4. 对包含多个拥挤航段的行程使用最小缩减比例。
5. 释放未实际占用的后续航段容量。
6. 将未满足需求重新分配一次，只考虑仍有容量的候选行程和“不出行”。
7. 第二次仍未满足的需求记为拒载或放弃出行，不再继续迭代。

比例缩减避免按公司、港口或计算顺序产生隐藏偏袒。重新分配只执行一次，以控制性能并保持结果容易解释。

结算后记录：

- 实际乘客数
- 可用座位数
- 满载率
- 因价格放弃的人数
- 因时间或换乘放弃的人数
- 因无座放弃的人数
- 选择竞争对手的人数

## 10. 收入与运营成本

### 10.1 收入

```text
dailyTicketRevenue = sum(actualPassengersOnSegment * paidSegmentFare)
```

换乘行程的收入按实际航段分别归属提供服务的公司。

### 10.2 燃料

```text
fuelUsed =
  distance
  * shipFuelPerDistance
  * modeFuelMultiplier
  * loadFuelModifier
  * leg.fuelModifier
```

第一版使用简化载重影响：

```text
loadFuelModifier = 0.90 + 0.20 * loadFactor
```

燃料默认在出发港购买。若一次航段所需燃料超过船只剩余燃料，则航线设计无效，除非增加技术停靠或更换船型。

### 10.3 其他成本

每日航线成本包括：

- 燃料费
- 星港停靠及旅客服务费
- 船员抽象成本
- 按飞行小时累计的维护准备金
- 基地外运营附加费
- 融资或租赁费用的日均摊销

购船费用不直接计入航线日利润，但财务页面同时显示计入折旧后的会计利润。

### 10.4 航线利润

```text
routeOperatingProfit =
  ticketRevenue
  - fuelCost
  - portCost
  - crewCost
  - maintenanceReserve
  - remoteOperationCost
```

航线分析同时显示过去 28 日实际值和未来 28 日预测值，并明确区分二者。

## 11. 准点率、可靠性和维护

每艘船具有可靠性与磨损值。第一版不模拟具体故障部件。

```text
dailyWearIncrease =
  flightHours
  * shipWearRate
  * hazardModifier
  * maintenancePolicyModifier
```

维护政策：

| 政策 | 成本倍率 | 磨损倍率 | 可用率倾向 |
| --- | ---: | ---: | --- |
| 节约 | 0.75 | 1.30 | 较低 |
| 标准 | 1.00 | 1.00 | 标准 |
| 预防性 | 1.30 | 0.72 | 较高 |

延误由可靠性、星港拥堵、航段危险和事件共同决定。界面至少将延误拆分为：

- 船只技术原因
- 星港拥堵
- 航行环境
- 上一航段连锁延误

## 12. 港口容量与拥堵

星港每天的计划座位吞吐量超过 `dailyCapacity` 后产生拥堵：

```text
utilization = plannedSeatMovements / dailyCapacity
```

- `utilization <= 0.85`：无拥堵惩罚。
- `0.85 < utilization <= 1.00`：停靠时间逐渐增加，最多增加 15%。
- `utilization > 1.00`：停靠时间和延误概率明显增加，超出部分越大惩罚越强。

第一版不设置硬性起降槽位，以免玩家因容量变化突然无法运行已有航线。

## 13. 基地影响

第一版基地只提供三类效果：

1. 可驻扎和维护的船只容量。
2. 维护时间与维护成本修正。
3. 基地外长期运营附加成本。

若一条航线没有经过所属公司的任何基地，则产生远程运营成本。若经过基地但周期过长，成本按离开基地后的累计飞行小时逐渐增加。

第一版不单独模拟船员、工程师、地勤和调度员；这些能力合并在基地容量中。

## 14. 事件修正

事件不能直接覆写基础数据，只提供有起止时间的修正层：

```ts
type MarketEvent = {
  id: string;
  announcedOnDay: number;
  startsOnDay: number;
  endsOnDay: number;
  recoveryDays: number;
  affectedPortIds: string[];
  demandModifiers: Partial<Record<PassengerClass, number>>;
  fuelPriceModifier?: number;
  portCapacityModifier?: number;
  travelTimeModifier?: number;
};
```

事件结束后，需求和成本在 `recoveryDays` 内线性或平滑恢复，避免市场瞬间跳回常态。

## 15. 每日结算顺序

为保证结果确定，所有系统严格按以下顺序执行：

1. 推进日期并更新事件状态。
2. 更新燃料价格、港口容量和航段状态。
3. 更新可用船只、维护和航线班次。
4. 生成各港口对潜在需求。
5. 构建当日可选行程。
6. 计算无约束乘客选择。
7. 应用运力限制并执行一次重新分配。
8. 结算实际客流和票价收入。
9. 结算燃料、港口、船员和维护成本。
10. 更新磨损、准点率、声誉和市场统计。
11. AI 读取结算后的市场数据并决定未来行动。
12. 保存当日摘要；每 28 日生成月度报告。

AI 的行动从下一游戏日开始生效，不能反向改变已经结算的客流。

## 16. 玩家可解释性

任意港口对都必须提供“为什么”面板：

```text
中央轨道站 → 新曙光殖民地
潜在需求：182 人/日
实际出行：139 人/日

玩家公司：61 人，44% 市场份额
天梭快航：52 人，37% 市场份额
其他/未出行：26 人，19%

玩家服务优势：票价低 12%，舒适度较高
玩家服务劣势：平均多一次换乘，等待时间长 4.2 小时
主要流失原因：换乘 18 人、无座 7 人、竞争对手更快 22 人
```

所有重要数字都应能展开查看组成项。预测值必须注明它假定竞争、事件和运力保持不变。

## 17. 缓存和性能边界

概念验证目标规模：

- 20 个星港
- 3 类乘客
- 2 家 AI 加玩家
- 50 条以内活跃航线
- 每个市场最多 12 个候选行程

性能策略：

- 只有航线、航段状态或事件变化时才重建服务图。
- 理论最快路径和基础需求按世界版本缓存。
- 每日只重新计算受到价格、班次、运力或事件变化影响的市场。
- UI 动画和经营结算使用不同状态；动画不得改变模拟结果。

在普通桌面浏览器中，单日结算目标低于 50 毫秒，28 日快速推进目标低于 500 毫秒。

## 18. 首批自动化验收情景

### 情景 A：价格敏感性

两家公司的其他条件相同，其中一家降价 20%。经济旅客份额应明显增加，商务和高端旅客份额变化较小。

### 情景 B：频率对容量的取舍

相同周座位数下，高频小船应获得更多商务旅客；低频大船因为成本较低，仍可能获得更高利润。

### 情景 C：直达与换乘

直达服务票价比一次换乘高 25%。商务和高端旅客应更偏好直达，经济旅客应有较高比例选择换乘。

### 情景 D：超空间走廊与曲速直达

超空间换乘服务速度快且价格低，曲速服务较贵但直达。两个方案都应在至少一个客群中具有合理市场。

### 情景 E：运力溢出

最受欢迎航线满载后，部分旅客应转向仍有座位的次优服务；不能出现总载客量超过任何共享航段容量。

### 情景 F：燃料冲击

某区域燃料价格上涨后，高燃料消耗曲速航线利润应明显下降，并可能使经由超空间走廊的服务更有竞争力。

### 情景 G：事件响应

活动预告期间需求不变；活动开始后指定客群需求上升；结束后在恢复期内平滑下降。

### 情景 H：确定性

相同种子、地图、公司状态和输入连续运行 364 日，两次结果必须完全一致。

## 19. 尚未冻结的调参项

以下内容需要通过可执行原型校准，不应视为最终数值：

- 三类客群的需求规模和选择权重
- 可接受票价的计算方式
- 换乘最短时间和等待时间上限
- 船型速度、燃料消耗、容量与价格
- 事件倍率
- 港口拥堵曲线
- 声誉变化速度
- AI 行动冷却时间

下一份规格应定义世界数据、六种初始船型，以及可接受票价和基础运营成本，使这些验收情景可以在无界面的模拟器中运行。
