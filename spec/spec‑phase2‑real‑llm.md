# spec‑phase2‑real‑llm.md

## 阶段前提

1. Phase1代码完整可用，调度架构、Agent角色、state状态定义全部稳定。
2. 项目根目录已存在 .env，配置好豆包（字节方舟）API密钥。
3. 本阶段**不改动多Agent架构，Agent数量不变，LangGraph工作流图结构不修改**。

## 阶段目标

把 Phase1 内部模拟推理替换为**真实豆包LLM完成各个Agent的思考生成**。

> 重要区分：
>
> - ✅ Agent思考生成内容 → 使用真实豆包LLM
> - ❌ 机票、酒店、预订、景点查询外部业务接口：依旧全部模拟生成，绝不调用真实旅游服务商API。

用户输入旅行需求，各个Agent交给豆包大模型做推理输出旅行相关内容，整体链路保持原有调度不变。

## 技术栈与依赖约束

1. 沿用phase0锁定的全部依赖版本，不随意升级主版本。
2. 新增允许依赖：仅增加豆包SDK/适配LangChain的豆包集成包，新增依赖必须按照AGENTS.md流程确认。
3. 读取项目根目录 `.env` 获取API密钥，密钥禁止硬编码写入代码。

## 需要修改实现范围（增量修改，禁止删除phase1有效代码）

### 1. 新增环境与模型封装

1. 新增 `src/llm.ts`：统一封装豆包LLM实例，从`.env`读取密钥，全局复用这个LLM对象。
2. .env.example 更新示例密钥字段。
3. 原有mock模拟逻辑**保留代码不要删除**，可以做开关：支持切换「mock模式 / 真实LLM模式」方便调试。

### 2. 修改全部Agent实现

- Travel Supervisor 主控Agent
- FlightSearchAgent
- HotelBookingAgent
- ActivitiesAgent
- BudgetingAgent

每个Agent不再使用内部写死模拟逻辑，调用封装好的豆包LLM，传入各自专属system prompt + graph state上下文，由大模型输出结果写入state。

> 原有state数据结构完全复用，不破坏graph流转。

### 3. CLI入口增强

命令行启动时，增加模式选项：

- `--mode mock`：使用phase1旧模拟逻辑（用于快速调试流程，不消耗LLM token）
- `--mode llm`：使用真实豆包大模型（phase2新能力）

## ✅本阶段交付标准

1. phase1原有mock模式依然完整可用，作为调试备用；
2. `--mode llm` 模式下，全部Agent使用豆包真实LLM推理；
3. .env管理密钥，密钥无硬编码；
4. 完整旅行规划链路跑通，输出由大模型真实生成；
5. 依旧内存运行，无数据库、无web服务。

## ❌Phase2【禁止清单】

1. ❌ 禁止新增/删减Agent角色，禁止修改LangGraph调度流程图；
2. ❌ **禁止接入真实机票、酒店、旅游第三方业务API**，业务数据依旧由LLM模拟生成，不能发起外部业务http请求；
3. ❌ 禁止开发Web UI、http后端接口服务；
4. ❌ 禁止数据库、持久化存储旅行方案；
5. ❌ 禁止大规模重构phase0‑phase1已稳定的graph、state结构；
6. ❌ 密钥绝对禁止硬编码到源码，不许提交密钥到仓库。

## 工作流强制规则

1. 增量开发，原有mock逻辑保留，不要直接删除；
2. 优先保证 `mock` 模式依旧可以正常跑通，再调试真实LLM模式；
3. 新增npm包严格遵守AGENTS.md流程，说明用途确认之后再引入；
4. 遇到不确定点停止编码，发起提问确认。
