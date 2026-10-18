import { Controls, Time, Tooltip } from '@videojs/react';
import type { ComponentProps } from 'react';

import { AirPlayButton } from '@/components/videojs/ui/airplay-button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { CaptionsButton } from '@/components/videojs/ui/captions-button';
import { CastButton } from '@/components/videojs/ui/cast-button';
import { FullscreenButton } from '@/components/videojs/ui/fullscreen-button';
import { PiPButton } from '@/components/videojs/ui/pip-button';
import { PlayButton } from '@/components/videojs/ui/play-button';
import { TimeSlider } from '@/components/videojs/ui/time-slider';
import { VolumePopover } from '@/components/videojs/ui/volume-popover';
import { cn } from '@/lib/resolve-class-name';

import { VideoSettingsMenu } from '../menus/settings-menu';

export interface NeutralVideoControlsProps {
  renderThumbnail?: NonNullable<ComponentProps<typeof TimeSlider>>['renderThumbnail'];
}

export function NeutralVideoControls({ renderThumbnail }: NeutralVideoControlsProps = {}) {
  return (
    <Controls.Root>
      <Controls.Backdrop className={'video-controls-backdrop'} />
      <Controls.Content className={cn('video-controls', 'video-controls-content', 'video-controls-wrap')}>
        <Tooltip.Provider>
          <Controls.Group className={'video-controls-start'}>
            <ButtonTooltip side="top">
              <PlayButton />
            </ButtonTooltip>
            <VolumePopover showTooltip side="right" orientation="horizontal" />
          </Controls.Group>

          <Controls.Group className={'video-time-slider-group'}>
            <Time.Group className={'media-time-group'}>
              <Time.Value className={'media-time-toggle'} type="current" toggle />
              <Time.Separator className={'media-time-separator'} />
              <Time.Value className={'media-time-duration-value'} type="duration" />
            </Time.Group>
            <TimeSlider previewOverflow="clamp" renderThumbnail={renderThumbnail} />
          </Controls.Group>

          <Controls.Group className={'video-controls-end'}>
            <ButtonTooltip side="top">
              <CaptionsButton className={'video-controls-captions-button'} />
            </ButtonTooltip>
            <VideoSettingsMenu />
            <Controls.Group className={'video-controls-trailing'}>
              <ButtonTooltip side="top">
                <CastButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <AirPlayButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <PiPButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <FullscreenButton />
              </ButtonTooltip>
            </Controls.Group>
          </Controls.Group>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
