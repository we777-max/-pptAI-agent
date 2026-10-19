# PPT Agent Starter Monorepo

这是一个面向“完整画布编辑器”的第一阶段可运行骨架。当前前端已经可以连接 `backend/`：新建 PPT 先进入居中的 Agent 创作页，消息通过 FastAPI + SSE 进入 LangGraph 兼容的 Agent 工作流，生成 Deck IR 后再切换到右侧 Agent + 可编辑画布。未启动后端时仍保留本地演示降级模式，方便单独开发 UI。

## 目录

```text
backend/                 FastAPI + SQLAlchemy + Alembic + LangGraph
renderer/                TypeScript + PptxGenJS HTTP 渲染服务
web/                     React/Vite 画布编辑器
sample/deck.json         可直接提交的最小 Deck IR
docker-compose.yml       PostgreSQL、API、Renderer、Web
```

## 快速启动（Docker）

```bash
docker compose up --build
```

启动后：

- API 文档：http://localhost:8010/docs
- 健康检查：http://localhost:8010/healthz
- 前端画布：http://localhost:3000
- Renderer 健康检查：http://localhost:3001/healthz

创建项目、deck 并生成：

```bash
PROJECT=$(curl -s -X POST http://localhost:8010/api/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Demo"}' | jq -r .id)

DECK=$(jq --arg project_id "$PROJECT" '.project_id = $project_id' sample/deck.json | \
  curl -s -X POST http://localhost:8010/api/v1/decks \
    -H 'content-type: application/json' -d @- | jq -r .id)

JOB=$(curl -s -X POST "http://localhost:8010/api/v1/decks/$DECK/generate" | jq -r .id)
curl "http://localhost:8010/api/v1/jobs/$JOB"
```

生成文件会写入 Compose 的 `pptx-data` volume；API 返回 `output_path`。生产环境应把该目录替换为 S3/OSS 适配器。

## 本地开发

### Windows 一键启动

在项目根目录双击 `start-dev.cmd`，或在 PowerShell 执行：

```powershell
.\start-dev.ps1
```

脚本会自动打开后端和前端窗口，并访问 http://localhost:3000。第一次运行会创建 `backend/.venv` 并安装后端依赖，也会安装前端 `node_modules`。

### API

```bash
cd backend
python -m venv .venv
. .venv/bin/activate        # Windows: .venv\\Scripts\\Activate.ps1
pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --reload --port 8010
pytest -q
```

不启动 Renderer 时，默认 `RENDERER_URL=stub://renderer`，工作流会写出一个可追踪的 stub 文件，方便先开发画布和接口；连接真实渲染器时设置 `RENDERER_URL=http://localhost:3001`。

### Renderer

```bash
cd renderer
npm install
npm run dev
npm test
```

### Web 前端（当前推荐：独立运行）

前端是独立的 React/Vite 画布应用，不需要启动 API、数据库、Renderer 或 Docker：

```bash
cd web
npm install
npm run dev
```

然后打开 http://localhost:3000。页面支持编辑文本和形状、插入本地图片、拖动元素、调整位置与大小、图片/形状缩放和水平/垂直翻转、新增页面；修改会自动保存到浏览器 `localStorage`，点击“导出设计稿”可以下载当前 Deck IR JSON。若 API 在 `http://127.0.0.1:8010` 可用，AI 创作会自动创建项目、Deck 和 Agent Session，并通过 SSE 接收进度和 Deck IR；保存按钮会把当前画布同步到后端。

点击“新建 PPT”会进入居中的 AI 创作首页，不会直接显示空白演示文稿。用户在中间聊天框提交指令后，后端 Agent 会先生成 Deck IR，再切换到画布编辑器；此时 Agent 聊天栏会移动到右侧。两个聊天框都支持“📎 上传附件”，当前 Phase 1 传递附件元数据，文件内容上传将在后续对象存储阶段接入。生成后的元素仍然可以拖动、缩放、旋转、翻转和在属性栏中修改。后端没有运行时，前端会使用本地 Mock 结果，不影响画布交互。

## 第一阶段数据模型

- `projects`：工作区/项目。
- `decks`：一个可编辑 deck，`ir_json` 保存版本化的 Deck IR 快照。
- `generation_jobs`：异步生成任务及状态机（`queued -> validating -> rendering -> completed|failed`）。
- `agent_sessions`：一个项目/Deck 的 Agent 会话。
- `agent_messages`：用户消息和附件元数据。
- `agent_runs`：一次 Agent 运行及当前步骤。
- `agent_events`：可回放的进度、Deck IR 更新和渲染事件，前端通过 SSE 消费。

迁移在 `backend/alembic/versions/0001_initial.py` 和 `backend/alembic/versions/0002_agent_phase1.py`。API 启动时默认自动建表（`AUTO_CREATE_TABLES=true`），部署时建议只使用 Alembic。

## Slide IR 约定

`backend/app/slide_ir.py` 是单一事实来源，Pydantic 模型同时提供运行时校验和 JSON Schema。支持：

- 文本：多行字符串、字体、字号、对齐、颜色
- 形状：矩形、圆角矩形、椭圆、线条，填充和描边
- 图片：本地路径、URL 或 data URI，`contain|cover|stretch`
- slide 画布尺寸、背景、notes、扩展 metadata

导出 JSON Schema：

```bash
cd backend
python -c "from app.slide_ir import DeckIR; import json; print(json.dumps(DeckIR.model_json_schema(), ensure_ascii=False, indent=2))"
```

## 工作流

`backend/app/workflow/graph.py` 使用 LangGraph（未安装时自动降级到同样语义的内置 runner），节点为：

1. `validate_ir`：验证 deck IR 和元素边界。
2. `prepare_render`：补充渲染元数据，固定 job 关联信息。
3. `render_pptx`：调用 Renderer HTTP API 或本地 stub。
4. `persist_result`：写回 job 状态和输出路径。

后续可在 `prepare_render` 前插入大纲生成、素材检索、版式优化和人工审批节点，而无需改变 API 契约。

## API 摘要

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/healthz` | 服务和数据库存活检查 |
| POST | `/api/v1/projects` | 创建项目 |
| GET | `/api/v1/projects` | 项目列表 |
| GET | `/api/v1/projects/{project_id}/history` | 项目历史 Deck |
| POST | `/api/v1/decks` | 创建并校验 Deck IR |
| GET | `/api/v1/decks/{deck_id}` | 获取 deck |
| PATCH | `/api/v1/decks/{deck_id}` | 保存画布和标题 |
| POST | `/api/v1/decks/{deck_id}/generate` | 创建生成 job |
| GET | `/api/v1/jobs/{job_id}` | 查询 job |
| POST | `/api/v1/agent/sessions` | 创建 Agent 会话 |
| POST | `/api/v1/agent/sessions/{session_id}/messages` | 发送 Agent 消息并创建 run |
| GET | `/api/v1/agent/runs/{run_id}` | 查询 Agent run |
| GET | `/api/v1/agent/runs/{run_id}/events` | SSE 事件流 |

## 下一步建议

1. 将 `ir_json` 改为事件溯源或对象存储快照，并增加 `version`/`parent_version`。
2. 用 Redis/Celery 或 LangGraph durable execution 替换进程内 `BackgroundTasks`。
3. 增加用户、组织、配额、审计日志和对象存储签名 URL。
4. 接入图片上传、素材库和对象存储签名 URL。

