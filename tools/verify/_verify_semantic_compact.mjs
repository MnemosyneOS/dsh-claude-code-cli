// Semantic compaction: the dropped history must become a usable digest, not a
// bare "N messages were omitted" count. Pure logic, no model call.
import { trimMessagesToBudget, summarizeDroppedMessages, estimateInputTokens } from '../../lib/bridge.js'

let pass = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''))
  if (ok) pass++
}

// A realistic early transcript: a legal-review task with tool calls.
const history = [
  { role: 'user', content: '请根据我上传的一审判决书和全部证据材料，独立完成二审上诉状。证据在 C:\\个人文件\\劳动争议_明象\\劳动纠纷一审_明象。' },
  { role: 'assistant', content: [
    { type: 'text', text: '我先读取判决书，核对关键认定。' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\个人文件\\劳动争议_明象\\判决书.pdf' } },
  ] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '判决书 43 页，案号（2026）粤0491民初3919号' }] },
  { role: 'assistant', content: [
    { type: 'text', text: '赔偿金基数应按解除前十二个月平均工资计算，律师版本误用了基本工资。' },
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'python check_numbers.py' } },
  ] },
  { role: 'user', content: '补充：春节 40 小时加班费也要单独立论。' },
  { role: 'assistant', content: [
    { type: 'text', text: '已核对三处金额：赔偿金差额 128,400 元，加班费 21,760 元，年休假 9,120 元。' },
  ] },
  // Recent messages that must survive the trim.
  { role: 'user', content: '现在写第一段。' },
  { role: 'assistant', content: '好的，先写当事人与上诉请求。' },
]

// --- 1. the digest keeps the facts, not just a count ---
const digest = summarizeDroppedMessages(history.slice(0, 6))
check('digest is non-empty', digest.length > 0, digest.length + ' chars')
check('digest names the user task', /上诉状/.test(digest))
check('digest records tools already run', /Read|Bash/.test(digest))
check('digest keeps the file path', /判决书\.pdf|劳动争议_明象/.test(digest))
check('digest keeps a key conclusion', /赔偿金基数|128,400/.test(digest))
check('digest has labelled sections', /早期用户诉求/.test(digest) && /已执行的操作/.test(digest))
check('digest is bounded', digest.length <= 1600, digest.length + ' chars')
check('digest is plain text, no JSON blobs', !/"type":"tool_use"/.test(digest))

// --- 2. trim reports what it dropped, and the two agree ---
const big = '长'.repeat(400)
const bulky = Array.from({ length: 40 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: `第${i}轮：${big}`,
}))
const trimmed = trimMessagesToBudget(bulky, 8000, 'system', [])
check('trim actually drops messages', trimmed.dropped > 0, 'dropped=' + trimmed.dropped)
check('trim exposes the dropped slice', Array.isArray(trimmed.droppedMessages) && trimmed.droppedMessages.length === trimmed.dropped)
check('kept + dropped equals input', trimmed.messages.length + trimmed.droppedMessages.length === bulky.length)
check('dropped slice is the oldest', trimmed.droppedMessages[0] === bulky[0])
check('kept slice ends at the newest', trimmed.messages[trimmed.messages.length - 1] === bulky[bulky.length - 1])
check('trim stays inside budget', trimmed.inputTokens <= 8000, 'tokens=' + trimmed.inputTokens)

// --- 3. edge cases must not throw ---
check('empty history gives empty digest', summarizeDroppedMessages([]) === '')
check('null input is tolerated', summarizeDroppedMessages(null) === '')
check('string content is read', /hello/.test(summarizeDroppedMessages([{ role: 'user', content: 'hello world' }])))
check('tool_result-only turns are not called user asks', !/早期用户诉求/.test(
  summarizeDroppedMessages([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }])))
check('digest respects a smaller cap', summarizeDroppedMessages(history, { maxChars: 60 }).length <= 60)

// --- 4. the digest must scale with the budget, not sit at a fixed size ---
// This mirrors toDshRequest's rule: 10% of the budget, clamped to 200..1600.
const digestCharsFor = (budget) => Math.max(200, Math.min(1600, Math.floor(budget * 0.10)))
for (const budget of [2000, 8000, 100000]) {
  const cap = digestCharsFor(budget)
  const d = summarizeDroppedMessages(bulky, { maxChars: cap })
  check(`digest scales for a ${budget}-token budget`, d.length <= cap, d.length + '/' + cap + ' chars')
  // The digest must fit inside the 15% headroom the trimmer reserves.
  const tokens = estimateInputTokens([{ role: 'user', content: d }])
  check(`digest fits the ${budget}-token headroom`, tokens <= budget * 0.15, 'tokens≈' + tokens)
}

const total = 25
console.log('\n' + pass + '/' + total + ' passed')
if (pass !== total) process.exit(1)
