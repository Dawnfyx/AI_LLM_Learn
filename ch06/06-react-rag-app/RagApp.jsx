// 06-react-rag-app/RagApp.jsx
import { useState, useRef, useEffect } from 'react'
import { useRag } from './useRag'

// 来源标签组件
function SourceTag({ source }) {
  return (
    <span
      title={`相似度 ${source.score}\n${source.preview}`}
      style={{
        fontSize: 11, padding: '2px 8px', borderRadius: 10,
        background: '#fff', border: '1px solid #bfdbfe',
        color: '#1d4ed8', cursor: 'help',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
    >
      {source.title}
      <span style={{ color: '#9ca3af', fontSize: 10 }}>{source.score}</span>
    </span>
  )
}

// 消息气泡
function MessageBubble({ message }) {
  const isUser = message.role === 'user'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 16 }}>
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 引用来源 */}
        {!isUser && message.sources?.length > 0 && (
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 8, padding: '8px 12px',
          }}>
            <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, marginBottom: 5 }}>
              📎 参考文档
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {message.sources.map((s, i) => <SourceTag key={i} source={s} />)}
            </div>
          </div>
        )}

        {/* 气泡 */}
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
          background: isUser ? '#4f46e5' : '#f3f4f6',
          color: isUser ? '#fff' : '#1f2937',
          fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap',
        }}>
          {message.content}
          {message.streaming && (
            <>
              <span style={{
                display: 'inline-block', width: 2, height: '1em',
                background: 'currentColor', verticalAlign: 'text-bottom',
                animation: 'blink .7s infinite',
              }} />
              <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// 上传表单
function UploadForm({ onUpload, uploading }) {
  const [title, setTitle]       = useState('')
  const [category, setCategory] = useState('general')
  const [content, setContent]   = useState('')

  async function handleSubmit() {
    if (!content.trim()) return
    await onUpload({ title: title || '未命名', category, content })
    setTitle('')
    setContent('')
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    setTitle(file.name.replace(/\.[^.]+$/, ''))
    setContent(text)
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb',
    borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
    boxSizing: 'border-box', outline: 'none', marginBottom: 6,
  }

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="文档标题" style={inputStyle}
      />
      <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
        <option value="general">通用</option>
        <option value="technical">技术</option>
        <option value="business">业务</option>
      </select>
      <textarea
        value={content} onChange={e => setContent(e.target.value)}
        placeholder="粘贴文档内容..."
        rows={4} style={{ ...inputStyle, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || uploading}
          style={{
            flex: 1, padding: '8px 0', background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            opacity: (!content.trim() || uploading) ? .45 : 1,
          }}
        >
          {uploading ? '上传中...' : '添加到知识库'}
        </button>
        <label style={{
          padding: '8px 12px', background: '#f3f4f6', color: '#374151',
          border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 12,
        }}>
          选文件
          <input type="file" accept=".txt,.md" onChange={handleFile} hidden />
        </label>
      </div>
    </div>
  )
}

export default function RagApp() {
  const {
    documents, messages, loading, uploading, statusMsg,
    loadDocuments, uploadDocument, deleteDocument, ask,
  } = useRag()

  const [question, setQuestion]     = useState('')
  const [filterCategory, setFilter] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { loadDocuments() }, [])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  async function handleAsk() {
    if (!question.trim() || loading) return
    const q = question
    setQuestion('')
    await ask(q, filterCategory)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, sans-serif', background: '#f8f9fa' }}>
      {/* 左侧知识库 */}
      <div style={{ width: 300, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          📚 知识库
          <span style={{ fontSize: 11, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 10, fontWeight: 400 }}>
            {documents.length} 篇
          </span>
        </div>

        <UploadForm onUpload={uploadDocument} uploading={uploading} />

        <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #f3f4f6' }}>
          {documents.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              暂无文档，请先上传
            </div>
          )}
          {documents.map(doc => (
            <div key={doc.id} style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f9fafb' }}>
              <span style={{ fontSize: 16 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{doc.category} · {doc.chunks} 片段</div>
              </div>
              <button
                onClick={() => deleteDocument(doc.id)}
                style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 16 }}
                onMouseEnter={e => e.target.style.color = '#ef4444'}
                onMouseLeave={e => e.target.style.color = '#d1d5db'}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧对话 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 8 }}>
              <div style={{ fontSize: 40 }}>🔍</div>
              <div>上传文档后，向我提问吧</div>
              <div style={{ fontSize: 12 }}>我会从知识库中找到相关内容来回答</div>
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {statusMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13, marginBottom: 8 }}>
              <div style={{ width: 14, height: 14, border: '2px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin .7s linear infinite', display: 'inline-block' }} />
              {statusMsg}
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
          <select
            value={filterCategory}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, marginBottom: 8, outline: 'none' }}
          >
            <option value="">搜索全部文档</option>
            <option value="technical">仅搜索技术文档</option>
            <option value="business">仅搜索业务文档</option>
          </select>
          <div style={{ display: 'flex', gap: 10 }}>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleAsk()}
              placeholder="输入问题... (Ctrl+Enter 提问)"
              rows={2}
              style={{ flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
            />
            <button
              onClick={handleAsk}
              disabled={loading || !question.trim()}
              style={{
                padding: '0 20px', background: '#4f46e5', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                opacity: (loading || !question.trim()) ? .45 : 1,
              }}
            >
              {loading ? '...' : '提问'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
