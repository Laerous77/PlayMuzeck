import { publicFetch } from '../admin/adminApi';
import { AudioTrackItem, Deck, Topic } from '../types';
import { storage } from './storage';

const CMS_KEYS = {
  catalog: 'muzeck_cms_catalog_v1',
  topics: 'muzeck_cms_topics_v1',
  decks: 'muzeck_cms_decks_v1',
  settings: 'muzeck_cms_settings_v1',
};

export interface SiteSettings {
  siteName: string;
  tagline: string;
  accentAudio: string;
  accentQuiz: string;
  themeId: string;
  footerNote: string;
  bundleOptions?: Array<{
    id: string;
    key: string;
    title: string;
    description: string;
    price: number;
  }>;
  fullBundlePrice?: number;
  fullBundleOriginalPrice?: number;
}

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'PlayMuzeck',
  tagline: 'Audio & Trivia Arena',
  accentAudio: '#FCA311',
  accentQuiz: '#FC1212',
  themeId: 'oxford-amber',
  footerNote: 'Platform Audio Interaktif & Pusat Kuis',
};

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function applySiteTheme(settings: SiteSettings) {
  const root = document.documentElement;
  root.style.setProperty('--accent-amber', settings.accentAudio || '#FCA311');
  root.style.setProperty('--accent-crimson', settings.accentQuiz || '#FC1212');
}

export async function loadCmsContent() {
  try {
    const [catalog, topics, decks, settings] = await Promise.all([
      publicFetch<AudioTrackItem[]>('/api/public/catalog'),
      publicFetch<Topic[]>('/api/public/topics'),
      publicFetch<Deck[]>('/api/public/decks'),
      publicFetch<SiteSettings>('/api/public/settings'),
    ]);
    writeCache(CMS_KEYS.catalog, catalog);
    writeCache(CMS_KEYS.topics, topics);
    writeCache(CMS_KEYS.decks, decks);
    writeCache(CMS_KEYS.settings, settings);
    applySiteTheme(settings);
    return {
      catalog: catalog || [],
      topics: topics || [],
      decks: decks || [],
      settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    };
  } catch (err) {
    console.error('[cms] Gagal memuat dari server, memakai cache lokal:', err);
    const settings = { ...DEFAULT_SETTINGS, ...readCache(CMS_KEYS.settings, {}) };
    applySiteTheme(settings);
    return {
      catalog: readCache<AudioTrackItem[]>(CMS_KEYS.catalog, []),
      topics: readCache<Topic[]>(CMS_KEYS.topics, []),
      decks: readCache<Deck[]>(CMS_KEYS.decks, []),
      settings,
    };
  }
}

export function mergeWithLocalCustom(remoteTopics: Topic[], remoteDecks: Deck[]) {
  const customTopics = storage.getCustomTopics();
  const customDecks = storage.getCustomDecks();
  const topicIds = new Set(remoteTopics.map((t) => t.id));
  const deckIds = new Set(remoteDecks.map((d) => d.id));
  return {
    topics: [...remoteTopics, ...customTopics.filter((t) => !topicIds.has(t.id))],
    decks: [...remoteDecks, ...customDecks.filter((d) => !deckIds.has(d.id))],
  };
}
