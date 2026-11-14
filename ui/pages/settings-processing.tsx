import { Anchor, Group, Paper, Radio, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfigEntry, HostMetrics } from '@ein/api';
import { SaveBar, settingOf, useViewSave } from '@ein/ui/components';
import { useCommand, useConfig } from '@ein/ui/hooks';

/** The settings a level sets: the media worker's budget, its jobs in flight and its share for work after import, and the engine's inline steps. */
const KEYS = ['CFG_CPU_SLOTS', 'CFG_CPU_WORKERS', 'CFG_CPU_NON_ENTRY_SLOTS', 'CFG_PIPELINE_MAX_CONCURRENT'] as const;

type Key = typeof KEYS[number];
type Values = Record<Key, string>;
type Level = { id: string; label: string; about: string; values: Values };

const CUSTOM = 'custom';

/**
 * The levels offered on a machine of `cores` cores: Standard, the settings' own defaults; More, half
 * the cores; and Full, all but one, which is left to PostgreSQL and the engine. Each keeps two in
 * five of its budget for work after import, and a budget of at least 2, which a video's encoding
 * takes. A level that comes to one before it is left out.
 */
const levelsFor = (cores: number, defaults: Values): Level[] => {
  const of = (slots: number): Values => ({
    CFG_CPU_SLOTS: String(slots),
    CFG_CPU_WORKERS: String(Math.max(4, slots + 1)),
    CFG_CPU_NON_ENTRY_SLOTS: String(Math.max(1, Math.round(slots * 0.4))),
    CFG_PIPELINE_MAX_CONCURRENT: String(Math.max(4, Math.min(cores, slots + 1))),
  });
  const levels: Level[] = [
    { id: 'standard', label: 'Standard', about: 'What EiN starts with: a little at a time, whatever the machine, which leaves most of it to other work.', values: defaults },
    {
      id: 'more',
      label: 'More',
      about: `Half of this machine's ${cores} cores: an import goes faster, and the machine stays usable for other work.`,
      values: of(Math.max(2, Math.floor(cores / 2))),
    },
    {
      id: 'full',
      label: 'Full',
      about: `All of this machine's ${cores} cores but one, kept for the database: for a machine that does little else.`,
      values: of(Math.max(2, cores - 1)),
    },
  ];
  return levels.filter((level, at) => levels.slice(0, at).every((before) => KEYS.some((key) => before.values[key] !== level.values[key])));
};

/** What a level's values come to, in a sentence. */
const sentence = (values: Values): string => {
  const slots = Number(values.CFG_CPU_SLOTS);
  return `Media work worth ${slots} ${
    slots === 1 ? 'slot' : 'slots'
  } at once — thumbnails, renditions, fingerprints, faces matched — with up to ${values.CFG_CPU_WORKERS} jobs in flight and ${values.CFG_CPU_NON_ENTRY_SLOTS} kept for work after import, and ${values.CFG_PIPELINE_MAX_CONCURRENT} other pipeline steps at once.`;
};

/**
 * Processing, a settings view of media's (`media.processing`, a `settings.views` panel): how much
 * media work runs at once, as a level — Standard, More or Full for this machine's cores
 * (`host-metrics`) — instead of the budgets it sets (`CFG_CPU_SLOTS`, `CFG_CPU_WORKERS`,
 * `CFG_CPU_NON_ENTRY_SLOTS`, and core's `CFG_PIPELINE_MAX_CONCURRENT`), saved together. Values set
 * one by one that are no level's are shown as such, and kept until a level is chosen.
 */
export default function ProcessingSettings() {
  const config = useConfig('system');
  const { data: host, loading: hostLoading } = useCommand<HostMetrics>('host-metrics');
  const save = useViewSave();
  const entries = KEYS.map((key) => settingOf(config.entries, key));
  const loaded = entries.every((entry): entry is ConfigEntry => entry !== undefined);
  const now = loaded ? Object.fromEntries(entries.map((entry) => [entry.key, entry.value])) as Values : undefined;
  const defaults = loaded ? Object.fromEntries(entries.map((entry) => [entry.key, entry.default])) as Values : undefined;
  const cores = host?.cpu?.cores;
  const levels = defaults && cores ? levelsFor(cores, defaults) : [];
  const inForce = now && levels.find((level) => KEYS.every((key) => level.values[key] === now[key]))?.id || CUSTOM;

  const [chosen, setChosen] = useState(inForce);
  useEffect(() => setChosen(inForce), [inForce]);

  if (config.loading || hostLoading) return <Skeleton height={320} radius='md' />;
  if (!now) return <Text c='dimmed'>{config.error?.message ?? 'The processing settings did not load.'}</Text>;

  const level = levels.find((each) => each.id === chosen);
  const changed = level ? KEYS.filter((key) => level.values[key] !== now[key]) : [];

  return (
    <Stack gap='lg'>
      {levels.length === 0 ? <Text size='sm' c='dimmed'>The machine does not say how many cores it has, so no level is offered.</Text> : (
        <Radio.Group
          value={chosen}
          onChange={(value) => {
            save.clear();
            setChosen(value);
          }}
          label='How much runs at once'
        >
          <SimpleGrid cols={{ base: 1, sm: levels.length }} spacing='sm' mt='xs'>
            {levels.map((each) => (
              <Radio.Card key={each.id} value={each.id} p='md' radius='md' disabled={save.busy}>
                <Group wrap='nowrap' align='flex-start'>
                  <Radio.Indicator />
                  <div>
                    <Text fw={600}>{each.label}</Text>
                    <Text size='sm' c='dimmed'>{each.about}</Text>
                  </div>
                </Group>
              </Radio.Card>
            ))}
          </SimpleGrid>
        </Radio.Group>
      )}

      <Paper p='md' radius='md' withBorder>
        <Stack gap='xs'>
          <Text fw={600}>{level ? (chosen === inForce ? 'Now' : `At ${level.label}`) : 'Now, as set one by one'}</Text>
          <Text size='sm'>{sentence(level?.values ?? now)}</Text>
          <Text size='xs' c='dimmed'>
            A video's encoding takes two slots, other work one. {Number((level?.values ?? now).CFG_CPU_SLOTS) > 4 &&
              "Most of it is the media service's work, so above 4 raise its EMS_LIMIT_TOOLS in the installation's .env to match. "}
            How many requests go to the media service's models at once, and the rest, are under{' '}
            <Anchor component={Link} to='/settings?category=Processing' size='xs'>Processing</Anchor> in the categories
            {inForce === CUSTOM && level ? '; choosing a level replaces what was set there' : ''}.
          </Text>
        </Stack>
      </Paper>

      <SaveBar
        save={save}
        dirty={changed.length > 0}
        onCancel={() => setChosen(inForce)}
        onSave={() => save.run(() => config.saveAll(Object.fromEntries(changed.map((key) => [key, level!.values[key]]))))}
      />
    </Stack>
  );
}
