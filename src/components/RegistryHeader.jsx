import { useStore } from '../store.jsx';
import Markdown from './Markdown.jsx';

// 老 KV 的 event 可能还没有 registryWelcome 字段：给一份与种子一致的兜底文案
// （这句本来就硬编码在旧版 Registry.jsx 里，属公开通用文案，不涉隐私）
const FALLBACK_WELCOME = "Your presence is truly the best present — but if you'd love to spoil the little one, here are a few ideas.";

// 礼物登记页头部（首字母徽标 + 标题 + 欢迎语）—— 从 Registry.jsx 原样抽出，
// 由登记页与后台 Event 标签页的实时预览共用：一份源码，预览永不漂移
export default function RegistryHeader() {
  const { event, babyInitial } = useStore();
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          width: '48px', height: '48px', margin: '0 auto 16px', borderRadius: '50%',
          background: '#EAF2F9', border: '1px solid #CBDDEE', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          font: "600 21px 'Cormorant Garamond',serif", color: '#5B84AE',
        }}
      >
        {babyInitial}
      </div>
      <div style={{ font: "500 clamp(34px,6vw,50px) 'Cormorant Garamond',serif", color: '#3D4A5C' }}>
        Gifts for {event.baby}
      </div>
      <div
        style={{
          font: "italic 500 16px 'Cormorant Garamond',serif", color: '#8A94A6',
          margin: '8px auto 0', maxWidth: '520px', lineHeight: '1.6',
        }}
      >
        <Markdown text={event.registryWelcome ?? FALLBACK_WELCOME} />
      </div>
    </div>
  );
}
