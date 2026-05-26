// 05-workflow-with-state/index.js
// 工作流状态持久化：中断恢复、历史回溯、状态快照
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph'
import { z } from 'zod'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
  temperature: 0,
})

const checkpointer = new MemorySaver()

// ── 场景：多步骤需求分析工作流 ──────────────────────────────
const State = Annotation.Root({
  requirement:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  feasibility:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  techStack:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  timeEstimate:  Annotation({ reducer: (_, n) => n, default: () => '' }),
  risks:         Annotation({ reducer: (_, n) => n, default: () => '' }),
  finalPlan:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  currentStep:   Annotation({ reducer: (_, n) => n, default: () => '' }),
})

async function feasibilityNode(state) {
  console.log('[步骤1] 可行性分析...')
  const res = await model.invoke([
    { role: 'system', content: '你是产品经理，评估需求可行性' },
    { role: 'user', content: `评估可行性（简短）：${state.requirement}` },
  ])
  return { feasibility: res.content, currentStep: 'feasibility' }
}

async function techStackNode(state) {
  console.log('[步骤2] 技术选型...')
  const res = await model.invoke([
    { role: 'system', content: '你是架构师，推荐技术栈' },
    { role: 'user', content: `推荐技术栈（列举3个方案）：${state.requirement}` },
  ])
  return { techStack: res.content, currentStep: 'techStack' }
}

async function estimateNode(state) {
  console.log('[步骤3] 工时估算...')
  const res = await model.invoke([
    { role: 'system', content: '你是项目经理，估算工时' },
    { role: 'user', content: `工时估算（按模块分解）：${state.requirement}` },
  ])
  return { timeEstimate: res.content, currentStep: 'estimate' }
}

async function riskNode(state) {
  console.log('[步骤4] 风险识别...')
  const res = await model.invoke([
    { role: 'system', content: '你是风险管理专家，识别项目风险' },
    { role: 'user', content: `识别技术和业务风险：${state.requirement}` },
  ])
  return { risks: res.content, currentStep: 'risks' }
}

async function planNode(state) {
  console.log('[步骤5] 生成最终方案...')
  const res = await model.invoke([
    { role: 'system', content: '你是项目负责人，整合所有分析生成行动计划' },
    { role: 'user', content: `整合分析，生成最终项目计划：
可行性：${state.feasibility}
技术栈：${state.techStack}
工时：${state.timeEstimate}
风险：${state.risks}

输出：项目启动文档摘要（300字内）` },
  ])
  return { finalPlan: res.content, currentStep: 'done' }
}

const analysisWorkflow = new StateGraph(State)
  .addNode('feasibility', feasibilityNode)
  .addNode('tech_stack',  techStackNode)
  .addNode('estimate',    estimateNode)
  .addNode('risk',        riskNode)
  .addNode('plan',        planNode)
  .addEdge(START,          'feasibility')
  .addEdge('feasibility',  'tech_stack')
  .addEdge('tech_stack',   'estimate')
  .addEdge('estimate',     'risk')
  .addEdge('risk',         'plan')
  .addEdge('plan',          END)
  .compile({ checkpointer })

// ── 演示1：执行工作流并查看检查点 ────────────────────────────
async function demo1_checkpoints() {
  console.log('=== 演示1：检查点记录 ===\n')

  const threadId = 'analysis_001'
  const config = { configurable: { thread_id: threadId } }

  await analysisWorkflow.invoke(
    { requirement: '开发一个前端组件库，包含 30 个基础组件，支持 Vue3 和 React' },
    config
  )

  // 获取当前状态
  const finalState = await analysisWorkflow.getState(config)
  console.log('\n当前步骤：', finalState.values.currentStep)
  console.log('最终方案（前200字）：', finalState.values.finalPlan?.slice(0, 200))

  // 获取历史记录（每个节点执行后都有快照）
  const history = []
  for await (const checkpoint of analysisWorkflow.getStateHistory(config)) {
    history.push({
      step: checkpoint.values.currentStep || 'start',
      timestamp: checkpoint.metadata?.created_at,
    })
  }
  console.log('\n执行历史（共', history.length, '个检查点）：')
  history.reverse().forEach(h => console.log(`  ${h.step}`))
}

// ── 演示2：从中间步骤恢复 ─────────────────────────────────────
async function demo2_resume() {
  console.log('\n=== 演示2：中断后恢复 ===\n')

  const threadId = 'analysis_002'
  const config = { configurable: { thread_id: threadId } }

  // 只执行到 estimate 节点（用 interruptBefore 暂停）
  const workflowWithPause = new StateGraph(State)
    .addNode('feasibility', feasibilityNode)
    .addNode('tech_stack',  techStackNode)
    .addNode('estimate',    estimateNode)
    .addNode('risk',        riskNode)
    .addNode('plan',        planNode)
    .addEdge(START,          'feasibility')
    .addEdge('feasibility',  'tech_stack')
    .addEdge('tech_stack',   'estimate')
    .addEdge('estimate',     'risk')
    .addEdge('risk',         'plan')
    .addEdge('plan',          END)
    .compile({
      checkpointer,
      interruptBefore: ['risk'],  // 在 risk 节点前暂停
    })

  // 第一次运行（暂停在 risk 之前）
  await workflowWithPause.invoke(
    { requirement: '重构公司前端项目，从 Vue2 迁移到 Vue3' },
    config
  )

  const stateAfterPause = await workflowWithPause.getState(config)
  console.log('暂停位置（next）：', stateAfterPause.next)
  console.log('已完成步骤：', stateAfterPause.values.currentStep)

  // 模拟一段时间后（或另一个进程中）继续
  console.log('\n继续执行工作流...')
  const finalResult = await workflowWithPause.invoke(null, config)

  console.log('执行完成，最终方案（前150字）：', finalResult.finalPlan?.slice(0, 150))
}

// ── 演示3：回滚到历史状态 ─────────────────────────────────────
async function demo3_rollback() {
  console.log('\n=== 演示3：回滚到历史状态 ===\n')

  const threadId = 'analysis_003'
  const config = { configurable: { thread_id: threadId } }

  await analysisWorkflow.invoke(
    { requirement: '开发移动端 H5 活动页面，需要支持微信分享' },
    config
  )

  // 找到 tech_stack 节点完成时的检查点
  const checkpoints = []
  for await (const cp of analysisWorkflow.getStateHistory(config)) {
    checkpoints.push(cp)
  }

  // 找到 tech_stack 步骤的检查点
  const techStackCheckpoint = checkpoints.find(
    cp => cp.values.currentStep === 'techStack'
  )

  if (techStackCheckpoint) {
    console.log('找到 tech_stack 检查点')
    console.log('当时的技术栈建议（前100字）：', techStackCheckpoint.values.techStack?.slice(0, 100))

    // 从该检查点重新运行（相当于回滚后重跑）
    const rollbackConfig = {
      configurable: {
        thread_id: 'analysis_003_retry',
        checkpoint_id: techStackCheckpoint.config?.configurable?.checkpoint_id,
      },
    }
    console.log('\n从 tech_stack 检查点重新执行后续步骤...')
    // 实际回滚：await analysisWorkflow.invoke(null, rollbackConfig)
  }
}

await demo1_checkpoints()
await demo2_resume()
await demo3_rollback()
