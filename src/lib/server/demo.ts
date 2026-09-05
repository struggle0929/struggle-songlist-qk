import { emptyAppearance } from '$lib/appearance';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { branding } from '$lib/branding';
import type { PublicCatalog } from '$lib/types';

export const localDemo = dev && env.LOCAL_DEMO === 'true';

export function getDemoCatalog(): PublicCatalog {
  return {
    settings: {
      appearance: emptyAppearance(),
      heroTitle: branding.title,
      avatar: '',
      background: '',
      bilibiliUrl: 'https://www.bilibili.com/'
    },
    tags: ['流行', '民谣', '英文'],
    songs: [
      {
        id: 'demo-1',
        title: '晴天',
        artist: '周杰伦',
        language: '中文',
        status: 'ready',
        tags: ['流行'],
        isPublic: true
      },
      {
        id: 'demo-2',
        title: '小幸运',
        artist: '田馥甄',
        language: '中文',
        status: 'learning',
        tags: ['流行'],
        isPublic: true
      },
      {
        id: 'demo-3',
        title: '成都',
        artist: '赵雷',
        language: '中文',
        status: 'ready',
        tags: ['民谣'],
        isPublic: true
      },
      {
        id: 'demo-4',
        title: 'Yesterday',
        artist: 'The Beatles',
        language: '英语',
        status: 'resting',
        tags: ['英文'],
        isPublic: true
      },
      {
        id: 'demo-5',
        title: '群青',
        artist: 'YOASOBI',
        language: '日语',
        status: 'learning',
        tags: ['流行'],
        isPublic: true
      },
      {
        id: 'demo-6',
        title: '稻香',
        artist: '周杰伦',
        language: '中文',
        status: 'ready',
        tags: ['流行'],
        isPublic: true
      }
    ]
  };
}
