const express = require('express');
const path = require('path');
const https = require('https');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  deepSeek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',       // 生产可用
    model: 'deepseek-chat',          // 生产模型
    modelFlash: process.env.DEEPSEEK_MODEL || 'deepseek-chat',     // 快速响应（deepseek-chat 兼容）
    maxTokens: 800,
    temperature: 0.3              // 低温度，保持回答稳定性
  },
  agent: {
    brandName: '智服 AI 客服',
    platform: '电商智能客服助手',
    version: 'v1.2',
    maxAutoRefund: 50,     // 自动退款上限（元）
    forceHumanRefund: 200, // 强制转人工金额（元）
    maxConversationRounds: 10, // 最大对话轮次
    escalationAngerThreshold: 2    // 连续未解决次数触发转人工
  }
};

// ============================================================
// 知识库（结构化，支持 RAG 检索）
// ============================================================
const KNOWLEDGE_BASE = {
  brand: {
    name: CONFIG.agent.brandName,
    platform: CONFIG.agent.platform,
    description: '7×24 小时在线，覆盖订单查询、物流追踪、退款查询',
    version: CONFIG.agent.version
  },
  docVersion: 'v1.1',
  docSummary: [
    '项目目标：7×24 在线，V1 重点覆盖订单状态、物流追踪、退款查询，优先实现高频低难度场景。',
    '场景策略：高频低难度先做；高频高难度做成人机协作；低频高难度不做或后期再做。',
    '冷启动策略：客服访谈、内部文档梳理、友商帮助中心参考、种子问题集自造并行推进。',
    '系统原则：简洁优先、行动导向、同理心、诚实不编造。',
    '安全边界：金额超阈值、投诉升级、用户强烈不满、法律合规咨询必须转人工。',
    '数据合规：支付信息、身份证等严禁进入 LLM，上下文只保留必要脱敏信息。',
    '评测与灰度：先内测再 1%/5%/30% 灰度，离线评测集持续回归。'
  ],

  // FAQ 知识库（用于 RAG 召回）
  faq: [
    // 订单类
    { id: 'faq_001', category: 'order', question: '我的订单到哪了？', answer: '请提供您的订单号，我来帮您查询订单状态。如果没有订单号，我可以帮您查看最近7天的订单列表。', keywords: ['订单', '到哪', '状态', '查询'] },
    { id: 'faq_002', category: 'order', question: '我昨天买的耳机什么时候发货？', answer: '通常下单后24小时内发货。让我查一下您的订单状态，如果有异常会立即反馈。', keywords: ['发货', '时间', '何时', '耳机'] },
    { id: 'faq_003', category: 'order', question: '我的订单为什么还没发货？', answer: '发货时间通常在付款后24-48小时。如果是预售商品以商品页面标注为准。让我帮您核实一下当前订单状态。', keywords: ['没发货', '发货', '延迟'] },
    { id: 'faq_004', category: 'order', question: '怎么查看历史订单？', answer: '您可以在个人中心-我的订单中查看全部历史订单，也可以直接告诉我订单号我来帮您查询。', keywords: ['历史', '查看', '订单'] },
    { id: 'faq_005', category: 'order', question: '订单支付成功了吗？', answer: '我来帮您确认。支付成功的订单会显示"已支付"状态，如果支付失败我们会保留订单30分钟供您重新支付。', keywords: ['支付', '成功', '付款'] },
    { id: 'faq_006', category: 'order', question: '订单显示已签收但我没收到怎么办？', answer: '这种情况建议您先确认是否是家人/同事代收，或已放在快递柜/驿站。如果确认没有收到，我马上为您转接人工客服处理。', keywords: ['签收', '没收到', '丢失'] },
    { id: 'faq_007', category: 'order', question: '为什么我的订单被取消了？', answer: '订单被取消常见原因：支付超时未付款、商品库存不足、系统风控拦截。我可以帮您查看具体原因。', keywords: ['取消', '订单', '原因'] },
    { id: 'faq_008', category: 'order', question: '订单里的商品怎么少了一件？', answer: '这通常是分批发货导致的，您可以在订单详情中查看发货批次。如果确实漏发，我为您转接人工核实补发。', keywords: ['少件', '漏发', '缺件'] },

    // 物流类
    { id: 'faq_009', category: 'logistics', question: '我的快递到哪了？', answer: '我来查一下物流轨迹。通常发货后1-2天可查到运输信息，帮我确认一下您的订单号。', keywords: ['快递', '到哪', '物流', '轨迹'] },
    { id: 'faq_010', category: 'logistics', question: '快递单号是多少？', answer: '让我查一下您的订单，物流单号一般在发货后系统自动更新，我可以在订单详情中找到。', keywords: ['单号', '快递', '物流'] },
    { id: 'faq_011', category: 'logistics', question: '为什么物流信息不更新？', answer: '物流信息更新可能存在延迟，通常24小时内会有新节点。如果超过48小时无更新，建议联系人工客服核查。', keywords: ['不更新', '物流', '延迟'] },
    { id: 'faq_012', category: 'logistics', question: '快递显示已签收但我没收到？', answer: '建议您先确认是否家人/同事代收，或已放快递柜/驿站。确认未收到请立即告诉我，我将为您转接人工处理。', keywords: ['签收', '没收到', '快递'] },
    { id: 'faq_013', category: 'logistics', question: '我的快递什么时候能到？', answer: '同城通常1-2天，跨省3-5天，偏远地区5-7天。具体以物流节点信息为准，我来帮您查询。', keywords: ['什么时候', '送达', '到货', '预计'] },
    { id: 'faq_014', category: 'logistics', question: '快递被拦截了怎么办？', answer: '快递被拦截通常是因为地址不详或收件人拒收。我可以帮您确认拦截原因，如需重新派送请告知我。', keywords: ['拦截', '快递', '退回'] },
    { id: 'faq_015', category: 'logistics', question: '快递破损了怎么办？', answer: '请您先拍照留存证据，然后在订单详情中申请售后，选择"商品破损"原因。我也可以直接为您转接人工快速处理。', keywords: ['破损', '快递', '损坏'] },

    // 退款/售后类
    { id: 'faq_016', category: 'refund', question: '怎么申请退款？', answer: '您可以在订单详情中点击"申请退款"按钮，根据提示选择退款原因并提交。如果金额在50元以内我可以直接为您处理，超过50元需要转人工审核。', keywords: ['申请', '退款', '怎么退'] },
    { id: 'faq_017', category: 'refund', question: '退款什么时候到账？', answer: '退款审核通过后，通常1-7个工作日原路退回。信用卡支付可能需要3-15个工作日，具体以银行为准。', keywords: ['到账', '退款', '时间', '多久'] },
    { id: 'faq_018', category: 'refund', question: '退款进度怎么查？', answer: '让我查一下您当前的退款单状态。退款进度通常显示为：待审核→审核中→已通过→退款中→已到账。', keywords: ['进度', '退款', '查询'] },
    { id: 'faq_019', category: 'refund', question: '为什么我的退款被拒绝了？', answer: '退款被拒的常见原因包括：超出退货时效、商品影响二次销售、缺少凭证等。我可以帮您查看具体原因，或转接人工复核。', keywords: ['拒绝', '退款', '驳回'] },
    { id: 'faq_020', category: 'refund', question: '七天无理由退货怎么操作？', answer: '在收货后7天内，您可以在订单详情页申请"七天无理由退货"，商品需保持完好未使用。退回运费由买家承担（如有运费险除外）。', keywords: ['七天', '无理由', '退货'] },
    { id: 'faq_021', category: 'refund', question: '商品发错了怎么处理？', answer: '很抱歉给您发错商品了！请您拍照留存，我立即为您转接人工客服，会为您安排重发或退款，并承担退货运费。', keywords: ['发错', '商品', '错发'] },
    { id: 'faq_022', category: 'refund', question: '收到的商品破损怎么办？', answer: '真的很抱歉！请您拍照留存破损证据，我可以立即为您转接人工，会为您安排补发或全额退款。', keywords: ['破损', '商品', '损坏', '收到'] },

    // 政策类
    { id: 'faq_023', category: 'policy', question: '退货政策是什么？', answer: '支持签收后7天无理由退货（特殊商品如内衣、食品除外）。退货商品需保持完好，不影响二次销售。退回运费由买家承担（有运费险除外）。', keywords: ['退货', '政策', '规则'] },
    { id: 'faq_024', category: 'policy', question: '退款规则是什么？', answer: '50元以内系统自动审批，超过50元需人工审核。审核通过后1-7个工作日原路退回。VIP会员享受优先审核，24小时内处理完毕。', keywords: ['退款', '规则', '政策'] },
    { id: 'faq_025', category: 'policy', question: '发货时效是多久？', answer: '现货商品24-48小时内发货，预售商品以商品页面标注为准。大促期间（双11/618）发货时效可能延长至72小时。', keywords: ['发货', '时效', '多久'] },
    { id: 'faq_026', category: 'policy', question: 'VIP会员有什么权益？', answer: 'VIP会员享受：优先处理通道、专属客服、退款审核缩短至24小时内、专属优惠活动。在个人中心可查看会员等级和权益详情。', keywords: ['VIP', '会员', '权益'] },
    { id: 'faq_027', category: 'policy', question: '商品有质量问题怎么办？', answer: '质量问题由商家承担退货运费。请您拍照留存证据，在订单详情申请售后选择"质量问题"，我会为您优先处理。', keywords: ['质量', '问题', '售后'] },
  ],

  // 系统工具描述（给 LLM 的 Function Calling 使用）
  tools: [
    {
      name: 'query_order',
      description: '查询用户订单信息。传入订单号查询单个订单，不传参数则返回最近7天订单列表。',
      parameters: { order_id: { type: 'string', description: '订单号，如 ORD20260601001，可选' } }
    },
    {
      name: 'query_logistics',
      description: '查询订单物流轨迹。需要订单号。',
      parameters: { order_id: { type: 'string', description: '订单号' } }
    },
    {
      name: 'query_refund',
      description: '查询退款进度。需要订单号。',
      parameters: { order_id: { type: 'string', description: '订单号' } }
    },
    {
      name: 'escalate_to_human',
      description: '转接人工客服。当无法解决问题、用户要求转人工、用户情绪激动、涉及金额超过200元、涉及投诉/差评时使用。',
      parameters: { reason: { type: 'string', description: '转人工原因' } }
    }
  ]
};

// ============================================================
// Mock 数据（生产环境替换为真实数据库查询）
// ============================================================
const MOCK_ORDERS = [
  {
    id: 'ORD20260601001',
    userId: 'user_001',
    product: '蓝牙耳机 Pro Max',
    price: 299,
    status: '已签收',
    createTime: '2026-06-01 10:30',
    address: '浙江省杭州市西湖区文三路138号',
    logistics: {
      company: '顺丰速运',
      trackingNo: 'SF1234567890',
      records: [
        { time: '2026-06-01 12:00', location: '杭州仓', desc: '商品已出库' },
        { time: '2026-06-02 08:00', location: '杭州转运中心', desc: '已到达杭州转运中心' },
        { time: '2026-06-02 15:30', location: '杭州拱墅区', desc: '快递员正在派送' },
        { time: '2026-06-02 18:00', location: '杭州拱墅区', desc: '已签收（本人）' }
      ],
      estimatedDelivery: '2026-06-02'
    }
  },
  {
    id: 'ORD20260602002',
    userId: 'user_001',
    product: 'Type-C 快充数据线',
    price: 39,
    status: '运输中',
    createTime: '2026-06-02 14:00',
    address: '浙江省杭州市西湖区文三路138号',
    logistics: {
      company: '中通快递',
      trackingNo: 'ZTO9876543210',
      records: [
        { time: '2026-06-02 20:00', location: '杭州仓', desc: '订单已进入发货流程' },
        { time: '2026-06-03 10:00', location: '杭州转运中心', desc: '已发出，前往目的地' }
      ],
      estimatedDelivery: '2026-06-04'
    }
  },
  {
    id: 'ORD20260528003',
    userId: 'user_001',
    product: '无线充电板',
    price: 129,
    status: '退款中',
    createTime: '2026-05-28 09:15',
    address: '浙江省杭州市西湖区文三路138号',
    refund: {
      id: 'REF20260528001',
      status: '审核通过',
      amount: 129,
      applyTime: '2026-06-01 10:00',
      estimatedArrival: '2026-06-05',
      reason: '七天无理由退货'
    }
  }
];

// ============================================================
// 工具函数
// ============================================================
function queryOrder(orderId, userId = 'user_001') {
  if (orderId) {
    return MOCK_ORDERS.find(o => o.id === orderId && o.userId === userId) || null;
  }
  // 返回最近7天订单
  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return MOCK_ORDERS.filter(o => o.userId === userId && new Date(o.createTime) >= cutoff);
}

function queryLogistics(orderId) {
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  return order && order.logistics ? order.logistics : null;
}

function queryRefund(orderId) {
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  return order && order.refund ? order.refund : null;
}

// FAQ 简单检索（生产环境应替换为向量检索）
function searchFAQ(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const item of KNOWLEDGE_BASE.faq) {
    const score = item.keywords.filter(k => q.includes(k)).length;
    if (score > 0 || item.question.includes(query) || query.includes(item.question.substring(0, 3))) {
      results.push({ ...item, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ============================================================
// DeepSeek LLM 调用
// ============================================================
async function callDeepSeek(messages, tools = []) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: CONFIG.deepSeek.model, // 使用生产模型
      messages,
      temperature: CONFIG.deepSeek.temperature,
      max_tokens: CONFIG.deepSeek.maxTokens,
      tools: tools.length > 0 ? tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.parameters,
            required: Object.keys(t.parameters)
          }
        }
      })) : undefined
    };

    const body = JSON.stringify(payload);
    const url = new URL(CONFIG.deepSeek.apiUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.deepSeek.apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(new Error(result.error.message || 'DeepSeek API error'));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================
// 构建系统 Prompt（注入知识库 + 护栏规则）
// ============================================================
function buildSystemPrompt(userId = 'user_001') {
  // 取 FAQ 知识库前 5 条作为示例注入（防止 LLM 编造）
  const faqSample = KNOWLEDGE_BASE.faq.slice(0, 5).map(f =>
    `Q: ${f.question}\nA: ${f.answer}`
  ).join('\n\n');
  const docSummary = KNOWLEDGE_BASE.docSummary.map(x => `- ${x}`).join('\n');

  return `你是${CONFIG.agent.brandName}，一个专业的电商智能客服助手。

## 身份定位
- 名称：${CONFIG.agent.brandName}
- 平台：${CONFIG.agent.platform}
- 版本：${CONFIG.agent.version}
- 服务对象：电商用户（订单查询、物流追踪、退款售后）

## 知识库版本
- 知识库：${KNOWLEDGE_BASE.docVersion}
- 这份知识库覆盖项目背景、场景优先级、冷启动策略、自建架构、灰度上线、评测体系、合规与安全护栏。
- 回答时优先参考以下摘要：
${docSummary}

## 对话原则（必须遵守）
1. **简洁优先**：能1句话说清楚的不说2句
2. **行动导向**：每次回复要么解决问题，要么明确下一步
3. **同理心**：用户抱怨或愤怒时，先共情再处理
4. **诚实**：不知道就说不知道，立即转人工，绝不编造

## 红线规则（绝对禁止）
- ❌ 不能承诺没把握的事（"一定能退款"、"100%准时"）
- ❌ 不能透露其他用户的任何信息
- ❌ 不能进行价格谈判或主动给优惠
- ❌ 不能使用过分熟络的语气
- ❌ 不能讨论政治、宗教、竞品

## 工具调用权限
- ✅ 可自动执行：query_order（查询订单）、query_logistics（查询物流）、query_refund（查询退款）
- ⚠️ 需二次确认：涉及金额修改、地址修改的操作
- 🚨 超过 ${CONFIG.agent.forceHumanRefund} 元必须转人工
- 🚨 金额在 ${CONFIG.agent.maxAutoRefund} 元以内可自动退款

## 转人工条件（满足任意一条立即调用 escalate_to_human）
1. 用户明确要求"转人工"
2. 连续2次未解决用户问题
3. 用户表达强烈不满（含"生气"、"投诉"、"差评"、"诈骗"等词）
4. 涉及金额超过 ${CONFIG.agent.forceHumanRefund} 元
5. 涉及投诉/差评/退货纠纷
6. 知识库无相关答案且无法处理

## 知识库参考（以下是部分高频问答，回答时请参考此风格）
${faqSample}

## 回答格式要求
- 使用友好、专业的语气
- 涉及订单/物流/退款时，在回答中包含具体数据
- 需要用户进一步操作时，用清晰的步骤说明
- 转人工时，说明原因并告知用户正在转接
`;
}

// ============================================================
// 对话状态管理（简单内存存储，生产环境替换为 Redis）
// ============================================================
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      messages: [],
      roundCount: 0,
      unresolvedCount: 0, // 连续未解决次数
      createdAt: Date.now()
    });
  }
  return sessions.get(sessionId);
}

// ============================================================
// 情绪检测（兜底规则，LLM 也会判断）
// ============================================================
function detectEmotion(message) {
  const angryWords = ['生气', '愤怒', '投诉', '差评', '诈骗', '假的', '骗子', '垃圾', '破公司', '超生气', '气死', '火大', '忍不了', '妈的'];
  const score = angryWords.filter(w => message.includes(w)).length;
  return score > 0 ? 'angry' : 'normal';
}

// ============================================================
// API 路由
// ============================================================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: CONFIG.agent.version, timestamp: Date.now() });
});

// 知识库信息
app.get('/api/knowledge', (req, res) => {
  res.json({
    brand: KNOWLEDGE_BASE.brand,
    docVersion: KNOWLEDGE_BASE.docVersion,
    docSummary: KNOWLEDGE_BASE.docSummary,
    faqCount: KNOWLEDGE_BASE.faq.length,
    tools: CONFIG.agent.toolPermissions || null,
    guardrails: {
      maxAutoRefund: CONFIG.agent.maxAutoRefund,
      forceHumanRefund: CONFIG.agent.forceHumanRefund
    }
  });
});

// 聊天接口（核心）
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', userId = 'user_001', attachments = [] } = req.body;
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';

  if (!normalizedMessage && (!Array.isArray(attachments) || attachments.length === 0)) {
    return res.json({ error: '请输入消息' });
  }

  const startTime = Date.now();
  const session = getSession(sessionId);
  const attachmentHint = Array.isArray(attachments) && attachments.length > 0
    ? attachments.map(a => a.name || a.kind || '附件').join(' ')
    : '';
  const emotion = detectEmotion(`${normalizedMessage} ${attachmentHint}`.trim());

  // 情绪检测：直接转人工
  if (emotion === 'angry') {
    return res.json({
      response: {
        type: 'escalate',
        content: `我完全理解您的心情，真的很抱歉给您带来了不好的体验。这个问题比较特殊，我来为您转接资深人工客服处理，确保给您一个满意的解决方案。请稍候，正在为您转接客服坐席...`,
        humanSummary: `用户情绪激动，原话："${normalizedMessage || '[仅附件消息]'}"。建议优先安抚处理，快速响应。`
      },
      latency: `${Date.now() - startTime}ms`,
      sessionId
    });
  }

  // 转人工关键词检测（兜底）
  const humanWords = ['转人工', '人工客服', '找人工', '客服电话'];
  if (humanWords.some(w => normalizedMessage.includes(w))) {
    return res.json({
      response: {
        type: 'escalate',
        content: `好的，我马上为您转接人工客服。在转接之前，我已将我们的对话摘要整理好，客服同事无需您重复说明情况，请稍候...`,
        humanSummary: `用户要求转人工。对话摘要：用户说"${normalizedMessage}"。`
      },
      latency: `${Date.now() - startTime}ms`,
      sessionId
    });
  }

  try {
    // 1. 构建消息历史
    const messages = [
      { role: 'system', content: buildSystemPrompt() }
    ];

    // 注入历史消息（最多最近6轮）
    const historyMessages = session.messages.slice(-6 * 2).map(m => ({
      role: m.role,
      content: m.content
    }));
    messages.push(...historyMessages);

    // 当前用户消息
    const attachmentContext = Array.isArray(attachments) && attachments.length > 0
      ? attachments.map((a, idx) => {
          const kind = a.kind || 'file';
          const name = a.name || `附件${idx + 1}`;
          const size = a.size ? `${Math.round(a.size / 1024)}KB` : '未知大小';
          const mime = a.mimeType || 'unknown';
          return `- ${kind}: ${name} (${mime}, ${size})`;
        }).join('\n')
      : '';
    const combinedContent = attachmentContext
      ? `${normalizedMessage || '用户发送了附件'}\n\n[附件信息]\n${attachmentContext}`
      : normalizedMessage;
    messages.push({ role: 'user', content: combinedContent });

    // 2. 调用 DeepSeek API（带工具调用）
    if (!CONFIG.deepSeek.apiKey) {
      return res.json({
        response: {
          type: 'escalate',
          content: '系统未配置大模型密钥，暂时无法自动回复，我已为您转人工处理。',
          humanSummary: `缺少 DEEPSEEK_API_KEY。用户原话："${normalizedMessage || '[仅附件消息]'}"。`
        },
        latency: `${Date.now() - startTime}ms`,
        sessionId
      });
    }

    const deepSeekRes = await callDeepSeek(messages, KNOWLEDGE_BASE.tools);
    const choice = deepSeekRes.choices[0];

    // 3. 处理工具调用
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const toolName = toolCall.function.name;
      let toolResult = {};

      if (toolName === 'query_order') {
        const args = JSON.parse(toolCall.function.arguments);
        const orders = queryOrder(args.order_id);
        toolResult = { result: orders };
      } else if (toolName === 'query_logistics') {
        const args = JSON.parse(toolCall.function.arguments);
        toolResult = { result: queryLogistics(args.order_id) };
      } else if (toolName === 'query_refund') {
        const args = JSON.parse(toolCall.function.arguments);
        toolResult = { result: queryRefund(args.order_id) };
      } else if (toolName === 'escalate_to_human') {
        const args = JSON.parse(toolCall.function.arguments);
        // 转人工
        session.messages.push(
          { role: 'user', content: combinedContent },
          { role: 'assistant', content: `[转人工：${args.reason}]` }
        );
        return res.json({
          response: {
            type: 'escalate',
            content: `好的，我马上为您转接人工客服。${args.reason}。请稍候，我已将对话摘要推送给客服坐席...`,
            humanSummary: `转人工原因：${args.reason}。用户原话："${normalizedMessage || '[仅附件消息]'}"。`
          },
          latency: `${Date.now() - startTime}ms`,
          sessionId
        });
      }

      // 将工具结果反馈给 LLM，生成最终回复
      messages.push(
        { role: 'assistant', content: null, tool_calls: choice.message.tool_calls },
        { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolResult) }
      );

      const finalRes = await callDeepSeek(messages);
      const finalContent = finalRes.choices[0].message.content;

      // 保存对话历史
      session.messages.push(
        { role: 'user', content: combinedContent },
        { role: 'assistant', content: finalContent }
      );

      // 尝试解析返回类型（订单/物流/退款/普通文本）
      let responseType = 'text';
      let extra = {};
      try {
        const parsed = JSON.parse(finalContent);
        if (parsed.type) responseType = parsed.type;
        extra = parsed;
      } catch (e) {
        // 非 JSON，按普通文本处理
      }

      return res.json({
        response: {
          type: responseType,
          content: finalContent,
          ...extra
        },
        latency: `${Date.now() - startTime}ms`,
        sessionId,
        usage: deepSeekRes.usage
      });
    }

    // 4. 无工具调用，直接返回 LLM 回复
    const content = choice.message.content;
    session.messages.push(
      { role: 'user', content: combinedContent },
      { role: 'assistant', content }
    );

    res.json({
      response: {
        type: 'text',
        content
      },
      latency: `${Date.now() - startTime}ms`,
      sessionId,
      usage: deepSeekRes.usage
    });

  } catch (error) {
    console.error('Chat API error:', error.message);
    res.json({
      response: {
        type: 'escalate',
        content: `抱歉，系统暂时出现了问题。我正在为您转接人工客服处理，请稍候...`,
        humanSummary: `系统错误：${error.message}。用户原话："${normalizedMessage || '[仅附件消息]'}"。`
      },
      latency: `${Date.now() - startTime}ms`,
      sessionId,
      error: true
    });
  }
});

// 订单查询
app.get('/api/orders', (req, res) => {
  res.json({ orders: MOCK_ORDERS });
});

app.get('/api/orders/:id', (req, res) => {
  const order = queryOrder(req.params.id);
  if (order) return res.json({ order });
  res.status(404).json({ error: '订单未找到' });
});

// ============================================================
// 启动服务
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     ${CONFIG.agent.brandName} - 企业级电商客服 Agent    ║
║     ${CONFIG.agent.platform}                       ║
╠══════════════════════════════════════════════════╣
║  服务地址: http://localhost:${PORT}                      ║
║  知识库版本: ${CONFIG.agent.version}                          ║
║  内置FAQ: ${KNOWLEDGE_BASE.faq.length} 个                            ║
║  Mock订单: ${MOCK_ORDERS.length} 个                            ║
║  LLM引擎: ${CONFIG.deepSeek.modelFlash}                  ║
╚══════════════════════════════════════════════════╝
  `);
});
