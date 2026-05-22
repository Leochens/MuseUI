
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAPISettings, saveAPISettings,
  TEXT_MODEL_PRESETS, IMAGE_MODEL_PRESETS,
} from '../services/apiKeyStore';
import { APIConfig, AIProvider } from '../types';
import {
  callGeminiTextAPI, callOpenAITextAPI,
  callGeminiImageAPI, callOpenAIImageAPI, callOpenAIChatImageAPI,
} from '../services/aiService';
import recommendedProxies from '../data/recommended-proxies.json';

interface Props {
  onConfigured?: () => void;
  onClose?: () => void;
  lang?: 'en' | 'zh';
}

interface ProxyRecommendation {
  name: string;
  name_zh: string;
  description: string;
  description_zh: string;
  url: string;
  supports: string[];
}

const officialApiGuides = [
  {
    id: 'gemini',
    title: { zh: 'Gemini 官方 API', en: 'Gemini Official API' },
    description: {
      zh: '推荐优先使用 Google 官方 Gemini API。稳定性、计费透明度、模型列表更新和错误信息都更可控，但需要可直接访问官方服务的网络环境。',
      en: 'Recommended first for Gemini. Stability, billing, model updates, and error messages are easier to trust, but it requires direct access to Google services.',
    },
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/apikey',
    endpoints: [
      { label: { zh: 'REST 根地址', en: 'REST root' }, value: 'https://generativelanguage.googleapis.com' },
      { label: { zh: '模型列表', en: 'Models list' }, value: 'https://generativelanguage.googleapis.com/v1beta/models' },
    ],
    steps: {
      zh: [
        'Provider 选择 Gemini',
        'Base URL 使用官方时可以留空；只有自定义网关或中转站才需要填写',
        'API Key 从 Google AI Studio 获取',
        '模型建议先用 gemini-2.5-flash；图片模型可从下拉或模型列表里选择可用项',
      ],
      en: [
        'Choose Gemini as the provider',
        'Leave Base URL empty for the official API; only fill it for a custom gateway or proxy',
        'Get the API Key from Google AI Studio',
        'Start with gemini-2.5-flash; choose an available image model from the dropdown or fetched model list',
      ],
    },
  },
  {
    id: 'openai',
    title: { zh: 'OpenAI 官方 API', en: 'OpenAI Official API' },
    description: {
      zh: '推荐优先使用 OpenAI 官方 API。接口协议清晰、兼容性最好，也更容易判断问题来自模型、额度还是参数。',
      en: 'Recommended first for OpenAI. The contract is clear, compatibility is strongest, and failures are easier to attribute to models, quota, or request parameters.',
    },
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    keyUrl: 'https://platform.openai.com/api-keys',
    endpoints: [
      { label: { zh: '文本端点', en: 'Text endpoint' }, value: 'https://api.openai.com/v1/chat/completions' },
      { label: { zh: '图片端点', en: 'Image endpoint' }, value: 'https://api.openai.com/v1/images/generations' },
    ],
    steps: {
      zh: [
        'Provider 选择 OpenAI',
        '文本 API 的 Base URL 填 chat/completions 端点',
        '图片 API 的 Base URL 填 images/generations 端点',
        'API Key 从 OpenAI Platform 获取，模型按官方账户可用列表选择',
      ],
      en: [
        'Choose OpenAI as the provider',
        'Use the chat/completions endpoint for text APIs',
        'Use the images/generations endpoint for image APIs',
        'Get the API Key from OpenAI Platform and select models available to your account',
      ],
    },
  },
];

const defaultAPIConfig = (provider: AIProvider = 'gemini'): APIConfig => ({
  id: crypto.randomUUID(),
  name: '',
  provider,
  baseUrl: provider === 'gemini' ? '' : 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  textModel: provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o',
  imageModel: provider === 'gemini' ? 'nado-banana-2' : 'gpt-image-2',
  enabled: true,
});

// Pinned models that should appear at the top of the dropdown
const PINNED_TEXT_MODELS = [
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview',
  'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'nado-banana-2',
];
const PINNED_IMAGE_MODELS = [
  'gemini-2.5-flash-image', 'gemini-3-pro-image-preview',
  'gpt-image-2', 'dall-e-3', 'nado-banana-2',
];

const getModelsEndpoint = (baseUrl: string, provider: AIProvider): string => {
  const url = baseUrl.trim();
  if (provider === 'gemini') {
    const root = url || 'https://generativelanguage.googleapis.com';
    return `${root.replace(/\/$/, '')}/v1beta/models?key=`;
  }
  // OpenAI-compatible: strip known path suffixes, append /models
  let cleaned = url;
  if (cleaned.endsWith('/chat/completions')) cleaned = cleaned.slice(0, -'/chat/completions'.length);
  else if (cleaned.endsWith('/images/generations')) cleaned = cleaned.slice(0, -'/images/generations'.length);
  return `${cleaned.replace(/\/$/, '')}/models`;
};

export default function ApiKeyConfig({ onConfigured, onClose, lang = 'zh' }: Props) {
  const isZh = lang === 'zh';
  const [textAPIs, setTextAPIs] = useState<APIConfig[]>([]);
  const [imageAPIs, setImageAPIs] = useState<APIConfig[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [proxies, setProxies] = useState<ProxyRecommendation[]>([]);

  // Collapsed state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Rename state
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Visibility state for API keys
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'text' | 'image'; id: string; name: string } | null>(null);

  // Fetched models per API id
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
  const [fetchingModelsId, setFetchingModelsId] = useState<string | null>(null);
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  // Track fetch signatures per API (provider|baseUrl|apiKey) to re-fetch when config changes
  const fetchedSignaturesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const settings = getAPISettings();
    setTextAPIs(settings.textAPIs.length > 0 ? settings.textAPIs : [defaultAPIConfig('gemini')]);
    setImageAPIs(settings.imageAPIs.length > 0 ? settings.imageAPIs : [defaultAPIConfig('gemini')]);
    setProxies(Array.isArray(recommendedProxies) ? (recommendedProxies as any) : []);
  }, []);

  const save = () => {
    saveAPISettings({ textAPIs, imageAPIs });
  };

  const handleAdd = (type: 'text' | 'image') => {
    const cfg = defaultAPIConfig('gemini');
    if (type === 'text') setTextAPIs(prev => [...prev, cfg]);
    else setImageAPIs(prev => [...prev, cfg]);
  };

  const handleRemove = (type: 'text' | 'image', id: string) => {
    if (type === 'text') setTextAPIs(prev => prev.filter(a => a.id !== id));
    else setImageAPIs(prev => prev.filter(a => a.id !== id));
    // Clean up fetched models for removed API
    setFetchedModels(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setFetchErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete fetchedSignaturesRef.current[id];
  };

  const handleUpdate = (type: 'text' | 'image', id: string, updates: Partial<APIConfig>) => {
    const trimmed: Partial<APIConfig> = { ...updates };
    if (trimmed.baseUrl !== undefined) trimmed.baseUrl = trimmed.baseUrl.trim().replace(/\s+/g, '');
    if (trimmed.apiKey !== undefined) trimmed.apiKey = trimmed.apiKey.trim().replace(/\s+/g, '');
    if (trimmed.textModel !== undefined) trimmed.textModel = trimmed.textModel.trim().replace(/\s+/g, '');
    if (trimmed.imageModel !== undefined) trimmed.imageModel = trimmed.imageModel.trim().replace(/\s+/g, '');
    const updater = (prev: APIConfig[]) => prev.map(a => a.id === id ? { ...a, ...trimmed } : a);
    if (type === 'text') setTextAPIs(updater);
    else setImageAPIs(updater);
  };

  const handleTest = async (type: 'text' | 'image', api: APIConfig) => {
    if (!api.apiKey.trim()) return;
    setTestingId(api.id);
    setTestResult(null);
    const start = Date.now();
    try {
      if (type === 'text') {
        if (api.provider === 'gemini') {
          await callGeminiTextAPI(api, { prompt: 'Hi' });
        } else {
          await callOpenAITextAPI(api, { prompt: 'Hi' });
        }
      } else {
        if (api.provider === 'gemini') {
          await callGeminiImageAPI(api, { prompt: 'A simple blue circle on white background', aspectRatio: '1:1' });
        } else {
          // Try images.generations first, fallback to chat.completions if proxy requires it
          try {
            await callOpenAIImageAPI(api, { prompt: 'A simple blue circle on white background', aspectRatio: '1:1' });
          } catch (e: any) {
            if (e.message?.includes('messages is required')) {
              await callOpenAIChatImageAPI(api, { prompt: 'A simple blue circle on white background', aspectRatio: '1:1' });
            } else {
              throw e;
            }
          }
        }
      }
      setTestResult({ id: api.id, ok: true, msg: isZh ? `✓ 成功 (${Date.now() - start}ms)` : `✓ OK (${Date.now() - start}ms)` });
    } catch (e: any) {
      setTestResult({ id: api.id, ok: false, msg: e.message || 'Failed' });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveAll = () => {
    save();
    onConfigured?.();
  };

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    const el = e.currentTarget as HTMLElement;
    el.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '1';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  };

  const handleDrop = (type: 'text' | 'image', targetId: string) => {
    if (!draggedId || draggedId === targetId) return;

    const reorder = (prev: APIConfig[]) => {
      const fromIndex = prev.findIndex(a => a.id === draggedId);
      const toIndex = prev.findIndex(a => a.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    };

    if (type === 'text') setTextAPIs(reorder);
    else setImageAPIs(reorder);
    setDraggedId(null);
    setDragOverId(null);
  };

  const startRename = (api: APIConfig) => {
    setEditingNameId(api.id);
    setEditingNameValue(api.name);
  };

  const commitRename = (type: 'text' | 'image', id: string) => {
    if (editingNameValue.trim()) {
      handleUpdate(type, id, { name: editingNameValue.trim() });
    }
    setEditingNameId(null);
  };

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Auto-fetch models when baseUrl and apiKey are both filled
  const fetchModelsForApi = useCallback(async (api: APIConfig, _type: 'text' | 'image', force = false) => {
    if (!api.baseUrl.trim() || !api.apiKey.trim()) {
      setFetchErrors(prev => ({ ...prev, [api.id]: isZh ? '请填写 Base URL 和 API Key' : 'Please enter Base URL and API Key' }));
      return;
    }

    const signature = `${api.provider}|${api.baseUrl.trim()}|${api.apiKey.trim()}`;
    if (!force && fetchedSignaturesRef.current[api.id] === signature) return;

    setFetchingModelsId(api.id);
    setFetchErrors(prev => { const n = { ...prev }; delete n[api.id]; return n; });

    try {
      const endpoint = getModelsEndpoint(api.baseUrl, api.provider);
      let models: string[] = [];

      if (api.provider === 'gemini') {
        const res = await fetch(`${endpoint}${api.apiKey}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${errText ? `: ${errText}` : ''}`);
        }
        const data = await res.json();
        models = (data.models || [])
          .map((m: any) => m.name?.replace(/^models\//, '') || m.name)
          .filter(Boolean);
      } else {
        const res = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${api.apiKey}` },
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${errText ? `: ${errText}` : ''}`);
        }
        const data = await res.json();
        models = (data.data || []).map((m: any) => m.id).filter(Boolean);
      }

      setFetchedModels(prev => ({ ...prev, [api.id]: models }));
      fetchedSignaturesRef.current[api.id] = signature;
    } catch (e: any) {
      const msg = e.message || (isZh ? '获取模型列表失败' : 'Failed to fetch models');
      setFetchErrors(prev => ({ ...prev, [api.id]: msg }));
      // Do NOT write signature on failure, so next change will retry
    } finally {
      setFetchingModelsId(null);
    }
  }, [isZh]);

  // Trigger auto-fetch when APIs change and have both url + key
  useEffect(() => {
    const allApis = [...textAPIs, ...imageAPIs];
    allApis.forEach(api => {
      if (!api.baseUrl.trim() || !api.apiKey.trim()) return;
      const signature = `${api.provider}|${api.baseUrl.trim()}|${api.apiKey.trim()}`;
      if (fetchedSignaturesRef.current[api.id] !== signature) {
        const type = textAPIs.some(a => a.id === api.id) ? 'text' : 'image';
        fetchModelsForApi(api, type, false);
      }
    });
  }, [textAPIs, imageAPIs, fetchModelsForApi]);

  const getModelOptions = (api: APIConfig, type: 'text' | 'image'): string[] => {
    const presets = type === 'text' ? TEXT_MODEL_PRESETS : IMAGE_MODEL_PRESETS;
    const fetched = fetchedModels[api.id] || [];
    const pinned = type === 'text' ? PINNED_TEXT_MODELS : PINNED_IMAGE_MODELS;

    // Combine presets + fetched, deduplicate
    const all = Array.from(new Set([...presets, ...fetched]));

    // Sort: pinned first, then others alphabetically
    return all.sort((a, b) => {
      const aPinned = pinned.includes(a);
      const bPinned = pinned.includes(b);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.localeCompare(b);
    });
  };

  const inputCls = 'w-full px-2.5 py-1.5 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-600 rounded-lg text-stone-900 dark:text-white text-xs placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';
  const selectCls = 'w-full px-2.5 py-1.5 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-600 rounded-lg text-stone-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent appearance-none';
  const labelCls = 'block text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-0.5 uppercase tracking-wider';

  const renderAPICard = (api: APIConfig, type: 'text' | 'image', index: number) => {
    const isCollapsed = collapsedIds.has(api.id);
    const isDragOver = dragOverId === api.id && draggedId !== api.id;
    const isEditingName = editingNameId === api.id;
    const isKeyVisible = visibleKeys.has(api.id);
    const isFetchingModels = fetchingModelsId === api.id;

    return (
      <div
        key={api.id}
        draggable
        onDragStart={(e) => handleDragStart(e, api.id)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, api.id)}
        onDrop={() => handleDrop(type, api.id)}
        className={`border rounded-xl transition-all ${isDragOver ? 'border-teal-400 dark:border-teal-500 ring-2 ring-teal-200 dark:ring-teal-900/40' : 'border-stone-200 dark:border-stone-700'} bg-stone-50 dark:bg-stone-800/50`}
      >
        {/* Card Header */}
        <div className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing">
          {/* Drag Handle */}
          <div className="text-stone-400 dark:text-stone-500 shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>

          {/* Index Badge */}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${index === 0 ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400'}`}>
            {index + 1}
          </span>

          {/* Name (Editable) */}
          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <input
                autoFocus
                value={editingNameValue}
                onChange={e => setEditingNameValue(e.target.value)}
                onBlur={() => commitRename(type, api.id)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(type, api.id); if (e.key === 'Escape') setEditingNameId(null); }}
                className="w-full text-xs font-bold bg-white dark:bg-stone-900 border border-teal-300 dark:border-teal-600 rounded px-1.5 py-0.5 text-stone-800 dark:text-stone-200 outline-none"
              />
            ) : (
              <button
                onClick={() => startRename(api)}
                className="text-xs font-bold text-stone-700 dark:text-stone-300 truncate hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-left w-full"
                title={api.name || (isZh ? '点击重命名' : 'Click to rename')}
              >
                {api.name || (isZh ? '未命名 API' : 'Unnamed API')}
              </button>
            )}
          </div>

          {/* Status Dot */}
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${api.enabled ? 'bg-green-500' : 'bg-stone-300 dark:bg-stone-600'}`} title={api.enabled ? (isZh ? '已启用' : 'Enabled') : (isZh ? '已禁用' : 'Disabled')} />

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => handleTest(type, api)}
              disabled={testingId === api.id || !api.apiKey.trim()}
              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-40 text-stone-500 dark:text-stone-400 transition-colors"
              title={isZh ? '测试' : 'Test'}
            >
              {testingId === api.id ? '...' : (isZh ? '测' : 'T')}
            </button>
            {testResult?.id === api.id && (
              <span className={`text-[10px] ${testResult.ok ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{testResult.msg}</span>
            )}
            <button
              onClick={() => toggleCollapse(api.id)}
              className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              title={isCollapsed ? (isZh ? '展开' : 'Expand') : (isZh ? '收起' : 'Collapse')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => setDeleteConfirm({ type, id: api.id, name: api.name || (isZh ? '未命名 API' : 'Unnamed API') })}
              className="p-1 text-stone-400 dark:text-stone-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              title={isZh ? '删除' : 'Remove'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Card Body */}
        {!isCollapsed && (
          <div className="px-3 pb-3 space-y-2">
            <div className="h-px bg-stone-200 dark:bg-stone-700" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Provider</label>
                <select
                  value={api.provider}
                  onChange={e => {
                    const p = e.target.value as AIProvider;
                    handleUpdate(type, api.id, {
                      provider: p,
                      baseUrl: p === 'gemini' ? '' : 'https://api.openai.com/v1/chat/completions',
                      textModel: p === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o',
                      imageModel: p === 'gemini' ? 'nado-banana-2' : 'gpt-image-2',
                    });
                    // Reset fetched models when provider changes
                    setFetchedModels(prev => {
                      const next = { ...prev };
                      delete next[api.id];
                      return next;
                    });
                    setFetchErrors(prev => {
                      const next = { ...prev };
                      delete next[api.id];
                      return next;
                    });
                    delete fetchedSignaturesRef.current[api.id];
                  }}
                  className={selectCls}
                >
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-stone-600 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={api.enabled}
                    onChange={e => handleUpdate(type, api.id, { enabled: e.target.checked })}
                    className="accent-teal-500"
                  />
                  {isZh ? '启用' : 'Enabled'}
                </label>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Base URL</label>
                <input
                  type="text"
                  value={api.baseUrl}
                  onChange={e => handleUpdate(type, api.id, { baseUrl: e.target.value })}
                  placeholder={api.provider === 'gemini'
                    ? (isZh ? '官方可留空；中转站才填根地址' : 'Leave empty for official API; proxy root URL only')
                    : type === 'text'
                      ? (isZh ? '官方文本端点：https://api.openai.com/v1/chat/completions' : 'Official text endpoint: https://api.openai.com/v1/chat/completions')
                      : (isZh ? '官方图片端点：https://api.openai.com/v1/images/generations' : 'Official image endpoint: https://api.openai.com/v1/images/generations')
                  }
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>API Key</label>
                <div className="relative">
                  <input
                    type={isKeyVisible ? 'text' : 'password'}
                    value={api.apiKey}
                    onChange={e => handleUpdate(type, api.id, { apiKey: e.target.value })}
                    placeholder="sk-... or AIza..."
                    className={`${inputCls} pr-9`}
                  />
                  <button
                    onClick={() => toggleKeyVisibility(api.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors p-0.5"
                    title={isKeyVisible ? (isZh ? '隐藏' : 'Hide') : (isZh ? '显示' : 'Show')}
                  >
                    {isKeyVisible ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              {type === 'text' ? (
                <div className="col-span-2">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>{isZh ? '文本模型' : 'Text Model'}</label>
                    <div className="flex items-center gap-1.5">
                      {fetchErrors[api.id] && (
                        <span className="text-[10px] text-red-500 dark:text-red-400 max-w-[200px] truncate" title={fetchErrors[api.id]}>
                          {fetchErrors[api.id]}
                        </span>
                      )}
                      {fetchedModels[api.id] && !fetchErrors[api.id] && (
                        <span className="text-[10px] text-green-600 dark:text-green-400">
                          {isZh ? `已获取 ${fetchedModels[api.id].length} 个模型` : `${fetchedModels[api.id].length} models fetched`}
                        </span>
                      )}
                      <button
                        onClick={() => fetchModelsForApi(api, 'text', true)}
                        disabled={isFetchingModels}
                        className="text-stone-400 dark:text-stone-500 hover:text-teal-600 dark:hover:text-teal-400 disabled:opacity-40 transition-colors p-0.5"
                        title={isZh ? '刷新模型列表' : 'Refresh model list'}
                      >
                        {isFetchingModels ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <select
                    value={api.textModel || ''}
                    onChange={e => handleUpdate(type, api.id, { textModel: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">{isZh ? '选择模型...' : 'Select model...'}</option>
                    {getModelOptions(api, 'text').map(m => (
                      <option key={m} value={m}>
                        {m} {PINNED_TEXT_MODELS.includes(m) ? (isZh ? '★' : '★') : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="col-span-2">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>{isZh ? '图片模型' : 'Image Model'}</label>
                    <div className="flex items-center gap-1.5">
                      {fetchErrors[api.id] && (
                        <span className="text-[10px] text-red-500 dark:text-red-400 max-w-[200px] truncate" title={fetchErrors[api.id]}>
                          {fetchErrors[api.id]}
                        </span>
                      )}
                      {fetchedModels[api.id] && !fetchErrors[api.id] && (
                        <span className="text-[10px] text-green-600 dark:text-green-400">
                          {isZh ? `已获取 ${fetchedModels[api.id].length} 个模型` : `${fetchedModels[api.id].length} models fetched`}
                        </span>
                      )}
                      <button
                        onClick={() => fetchModelsForApi(api, 'image', true)}
                        disabled={isFetchingModels}
                        className="text-stone-400 dark:text-stone-500 hover:text-teal-600 dark:hover:text-teal-400 disabled:opacity-40 transition-colors p-0.5"
                        title={isZh ? '刷新模型列表' : 'Refresh model list'}
                      >
                        {isFetchingModels ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <select
                    value={api.imageModel || ''}
                    onChange={e => handleUpdate(type, api.id, { imageModel: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">{isZh ? '选择模型...' : 'Select model...'}</option>
                    {getModelOptions(api, 'image').map(m => (
                      <option key={m} value={m}>
                        {m} {PINNED_IMAGE_MODELS.includes(m) ? (isZh ? '★' : '★') : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 w-[80%] shadow-2xl flex flex-col h-[90vh] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-lg flex items-center justify-center text-white text-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                <line x1="6" y1="12" x2="18" y2="12"/>
              </svg>
            </div>
            <div>
              <h2 className="text-stone-900 dark:text-white font-bold text-sm">{isZh ? 'API 设置' : 'API Settings'}</h2>
              <p className="text-stone-500 text-xs">{isZh ? '配置文本思考和图片生成 API，支持多源 fallback' : 'Configure text & image APIs with fallback'}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors p-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden px-6 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full min-h-0">
            {/* Left: API Config */}
            <div className="lg:col-span-2 flex flex-col h-full min-h-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">
                {/* Text APIs */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between shrink-0 mb-3">
                    <h3 className="text-sm font-bold text-stone-700 dark:text-stone-200">{isZh ? '文本思考 API' : 'Text Thinking APIs'}</h3>
                    <button
                      onClick={() => handleAdd('text')}
                      className="text-[10px] px-2 py-1 rounded bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-600 dark:text-stone-300 transition-colors"
                    >
                      + {isZh ? '添加' : 'Add'}
                    </button>
                  </div>
                  <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                    {textAPIs.map((api, i) => renderAPICard(api, 'text', i))}
                  </div>
                  {textAPIs.length === 0 && (
                    <div className="text-center text-stone-400 dark:text-stone-500 text-xs py-8 border border-dashed border-stone-300 dark:border-stone-700 rounded-xl">
                      {isZh ? '暂无配置，点击添加' : 'No APIs configured'}
                    </div>
                  )}
                  <p className="text-[11px] text-stone-400 dark:text-stone-500 leading-relaxed mt-2 shrink-0">
                    {isZh
                      ? '💡 推荐模型：gemini-2.5-flash（快速）、gemini-2.5-pro（高质量）、nado-banana-2。也可使用 GPT-4o 等 OpenAI 兼容模型。'
                      : '💡 Recommended: gemini-2.5-flash (fast), gemini-2.5-pro (quality), nado-banana-2. OpenAI-compatible models like GPT-4o also work.'}
                  </p>
                </div>

                {/* Image APIs */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between shrink-0 mb-3">
                    <h3 className="text-sm font-bold text-stone-700 dark:text-stone-200">{isZh ? '图片生成 API' : 'Image Generation APIs'}</h3>
                    <button
                      onClick={() => handleAdd('image')}
                      className="text-[10px] px-2 py-1 rounded bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-600 dark:text-stone-300 transition-colors"
                    >
                      + {isZh ? '添加' : 'Add'}
                    </button>
                  </div>
                  <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                    {imageAPIs.map((api, i) => renderAPICard(api, 'image', i))}
                  </div>
                  {imageAPIs.length === 0 && (
                    <div className="text-center text-stone-400 dark:text-stone-500 text-xs py-8 border border-dashed border-stone-300 dark:border-stone-700 rounded-xl">
                      {isZh ? '暂无配置，点击添加' : 'No APIs configured'}
                    </div>
                  )}
                  <p className="text-[11px] text-stone-400 dark:text-stone-500 leading-relaxed mt-2 shrink-0">
                    {isZh
                      ? '💡 推荐模型：gemini-2.5-flash-preview-image-generation（推荐）、imagen-4.0-generate-preview-05-20、nado-banana-2、gpt-image-2。也可使用即梦、DALL·E 3 等。'
                      : '💡 Recommended: gemini-2.5-flash-preview-image-generation, imagen-4.0-generate-preview-05-20, nado-banana-2, gpt-image-2. Jimeng, DALL·E 3, etc. also work.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Official API guide + fallback proxies */}
            <div className="lg:col-span-1 flex flex-col h-full min-h-0 overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-3 custom-scrollbar space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-stone-700 dark:text-stone-200 mb-2">
                    {isZh ? '推荐官方方式' : 'Official API First'}
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
                    {isZh
                      ? '优先使用 OpenAI、Gemini 等官方 API。它们通常更稳定、文档更完整、额度和错误信息也更透明；前提是你有可直接访问官方服务的网络环境。'
                      : 'Prefer official APIs such as OpenAI and Gemini. They are usually more stable, better documented, and clearer about quota and errors; this requires direct access to the official services.'}
                  </p>
                </div>

                <div className="space-y-3">
                  {officialApiGuides.map((guide) => (
                    <details
                      key={guide.id}
                      className="rounded-xl border border-teal-200 dark:border-teal-900/50 bg-teal-50/70 dark:bg-teal-950/20"
                    >
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-stone-800 dark:text-stone-100 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">
                        {isZh ? guide.title.zh : guide.title.en}
                      </summary>
                      <div className="px-3 pb-3">
                        <div>
                          <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-relaxed mt-1">
                            {isZh ? guide.description.zh : guide.description.en}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0 mt-2 mb-2">
                          <a
                            href={guide.keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-stone-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
                          >
                            {isZh ? 'Key' : 'Key'}
                          </a>
                          <a
                            href={guide.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-stone-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
                          >
                            {isZh ? '文档' : 'Docs'}
                          </a>
                        </div>

                        <div className="space-y-1.5 mb-2">
                          {guide.endpoints.map((endpoint) => (
                            <div key={endpoint.value} className="text-[10px] leading-relaxed">
                              <span className="text-stone-500 dark:text-stone-400">
                                {isZh ? endpoint.label.zh : endpoint.label.en}:
                              </span>
                              <code className="block mt-0.5 px-2 py-1 rounded bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[10px] text-stone-700 dark:text-stone-200 break-all">
                                {endpoint.value}
                              </code>
                            </div>
                          ))}
                        </div>

                        <ol className="text-[10px] text-stone-600 dark:text-stone-300 leading-relaxed space-y-1 list-decimal list-inside">
                          {(isZh ? guide.steps.zh : guide.steps.en).map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  ))}
                </div>

                {proxies.length > 0 && (
                  <details className="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50">
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-stone-700 dark:text-stone-200 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">
                      {isZh ? '备选：中转站（没有魔法时再看）' : 'Fallback: Proxies'}
                    </summary>
                    <div className="px-3 pb-3">
                      <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 mb-3">
                        {isZh
                          ? '免责声明：以上内容仅是作者使用过的，觉得还可以，但并不保证一直有效和稳定。'
                          : 'Disclaimer: these are only services the author has used and found acceptable; they are not guaranteed to remain available or stable.'}
                      </p>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed mb-3">
                        {isZh
                          ? '如果无法直接连接官方 API，可以把中转站作为备选。使用前请自行确认价格、隐私、可用模型和服务条款。'
                          : 'If you cannot connect to official APIs directly, use proxies only as a fallback. Check pricing, privacy, available models, and terms yourself before use.'}
                      </p>

                      <div className="space-y-2">
                        {proxies.map((p: any, i: number) => (
                          <a
                            key={i}
                            href={p.registerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800/60 hover:border-teal-500/50 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-bold text-stone-700 dark:text-stone-200 truncate">{p.name}</span>
                              <span className="text-[10px] text-teal-600 dark:text-teal-400 shrink-0">{isZh ? '获取 Key' : 'Get Key'}</span>
                            </div>
                            <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-relaxed">{p.description}</p>
                          </a>
                        ))}
                      </div>

                      <div className="p-3 bg-white dark:bg-stone-800/60 rounded-xl border border-stone-200 dark:border-stone-700 mt-3">
                        <p className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-2">
                          {isZh ? '中转站使用指南' : 'How to use a proxy'}
                        </p>
                        <ol className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed space-y-1 list-decimal list-inside">
                          <li>{isZh ? '点击上方卡片，前往站点注册' : 'Click a card above to register'}</li>
                          <li>{isZh ? '找到「令牌管理」，创建 API Key' : 'Find "Token Management" and create a token'}</li>
                          <li>{isZh ? '找到「充值入口」，充值余额' : 'Find the top-up page and add balance'}</li>
                          <li>{isZh ? '在「模型广场」查看可用模型和端点' : 'Check "Model Hub" for models and endpoint URL'}</li>
                          <li>{isZh ? '将端点、模型名和 Key 填入左侧配置框' : 'Enter endpoint, model, and Key on the left'}</li>
                        </ol>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-200 dark:border-stone-700 flex items-center justify-between shrink-0">
          <p className="text-stone-400 dark:text-stone-500 text-[10px]">
            {isZh ? 'API Key 仅保存在浏览器本地' : 'API Keys are stored locally in your browser only'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSaveAll}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isZh ? '保存' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-stone-800 rounded-xl p-5 max-w-sm w-full shadow-2xl border border-stone-200 dark:border-stone-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </div>
              <h3 className="text-sm font-bold text-stone-800 dark:text-white">
                {isZh ? '确认删除' : 'Confirm Delete'}
              </h3>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-4">
              {isZh
                ? `确定要删除 API 配置「${deleteConfirm.name}」吗？此操作不可撤销。`
                : `Are you sure you want to delete the API config "${deleteConfirm.name}"? This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={() => {
                  handleRemove(deleteConfirm.type, deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                className="px-3 py-1.5 text-xs bg-red-500 hover:bg-red-400 text-white rounded-lg transition-colors"
              >
                {isZh ? '删除' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
