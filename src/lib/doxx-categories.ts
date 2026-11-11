import { Brain, Gamepad2, MonitorPlay, PlayCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** The four kinds of material a Doxxmarks topic can hold. Everything a topic
 * offers — an interactive class, a concept video, a practice game, a HOTS
 * case study, a virtual lab — lands in exactly one of these, so the topic
 * page reads as labelled sections instead of one undifferentiated grid. */
export type DoxxCategory = 'interactive' | 'videos' | 'playables' | 'hots';

export interface DoxxCategoryMeta {
  id: DoxxCategory;
  /** i18n key for the section heading. */
  labelKey: string;
  /** i18n key for the short line under the heading. */
  hintKey: string;
  icon: LucideIcon;
  /** Reuses the subject tone palette (`tone-*` in styles.css), which already
   * carries both a light and a dark value for every accent. */
  tone: 'blue' | 'rose' | 'green' | 'amber';
}

/** Display order — the page walks this list, so it doubles as the section
 * sequence and the lesson ordering used by the `?lesson=` deep link. */
export const DOXX_CATEGORIES: DoxxCategoryMeta[] = [
  { id: 'interactive', labelKey: 'doxx.cat.interactive', hintKey: 'doxx.cat.interactiveHint', icon: MonitorPlay, tone: 'blue' },
  { id: 'videos', labelKey: 'doxx.cat.videos', hintKey: 'doxx.cat.videosHint', icon: PlayCircle, tone: 'rose' },
  { id: 'playables', labelKey: 'doxx.cat.playables', hintKey: 'doxx.cat.playablesHint', icon: Gamepad2, tone: 'green' },
  { id: 'hots', labelKey: 'doxx.cat.hots', hintKey: 'doxx.cat.hotsHint', icon: Brain, tone: 'amber' },
];

const CATEGORY_BY_ID = new Map(DOXX_CATEGORIES.map(c => [c.id, c]));

export function categoryMeta(id: DoxxCategory): DoxxCategoryMeta {
  return CATEGORY_BY_ID.get(id) ?? DOXX_CATEGORIES[0]!;
}

/** Extramarks content group → the section it belongs in. Practice games are
 * the only true "playables"; labs, simulations, 3D and custom interactives
 * all behave like the interactive classes, so they share that section and
 * keep their own type label on the card. Anything the crawler introduces
 * later defaults to interactive rather than being dropped. */
const ACTIVITY_CATEGORY: Record<string, DoxxCategory> = {
  'Practice Game': 'playables',
  'Case Study (HOTS)': 'hots',
};

export function categoryForActivity(type: string): DoxxCategory {
  return ACTIVITY_CATEGORY[type] ?? 'interactive';
}
