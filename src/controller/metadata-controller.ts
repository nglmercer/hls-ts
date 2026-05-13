import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { LevelDetails } from '../types/level';
import { Logger } from '../utils/logger';

export interface DateRange {
  id: string;
  class?: string;
  startDate: string;
  endDate?: string;
  duration?: number;
  plannedDuration?: number;
  scte35Cmd?: string;
  scte35Out?: string;
  scte35In?: string;
  endOnNext?: boolean;
  attributes: Record<string, string>;
  // Calculated fields
  startTimeline?: number;
  endTimeline?: number;
}

export class MetadataController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _dateranges: DateRange[] = [];
  private _activeDateranges: Set<string> = new Set();
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _timelineOffset: number | null = null; // Timeline start in unix seconds
  private logger = new Logger('MetadataController');

  constructor(hls: Hls) {
    this.hls = hls;
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._startPolling();
  };

  _onMediaDetached = (): void => {
    this._stopPolling();
    this._media = null;
  };

  _onLevelUpdated = (data: { details: LevelDetails }): void => {
    if (data.details.dateranges) {
      this._dateranges = data.details.dateranges as DateRange[];
      this._updateTimelineMapping(data.details);
    }
  };

  private _updateTimelineMapping(details: LevelDetails): void {
    // Find first fragment with programDateTime to establish timeline mapping
    const refFrag = details.fragments.find(f => f.programDateTime > 0);
    if (refFrag) {
      // Timeline offset = PDT (seconds) - Timeline Position (seconds)
      this._timelineOffset = (refFrag.programDateTime / 1000) - refFrag.start;
      
      // Calculate timeline positions for all dateranges
      this._dateranges.forEach(dr => {
        const startUnix = Date.parse(dr.startDate) / 1000;
        dr.startTimeline = startUnix - this._timelineOffset!;
        
        const duration = dr.duration || dr.plannedDuration || 0;
        if (duration > 0) {
          dr.endTimeline = dr.startTimeline + duration;
        } else if (dr.endDate) {
          dr.endTimeline = (Date.parse(dr.endDate) / 1000) - this._timelineOffset!;
        }
      });
      
      this.logger.log(`Updated timeline mapping. Offset: ${this._timelineOffset}, Ranges: ${this._dateranges.length}`);
    }
  }

  private _startPolling(): void {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._checkDateranges(), 250);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _checkDateranges(): void {
    if (!this._media || this._dateranges.length === 0 || this._timelineOffset === null) return;

    const currentTime = this._media.currentTime;
    
    this._dateranges.forEach(dr => {
      if (dr.startTimeline === undefined) return;

      const isInside = currentTime >= dr.startTimeline && (dr.endTimeline === undefined || currentTime < dr.endTimeline);
      
      if (isInside && !this._activeDateranges.has(dr.id)) {
        this._activeDateranges.add(dr.id);
        this.hls.trigger(Events.DATERANGE_ENTERED, dr);
        this.logger.log(`Entered DateRange: ${dr.id} at ${currentTime.toFixed(2)}s`);
      } else if (!isInside && this._activeDateranges.has(dr.id)) {
        this._activeDateranges.delete(dr.id);
        this.hls.trigger(Events.DATERANGE_EXITED, dr);
        this.logger.log(`Exited DateRange: ${dr.id} at ${currentTime.toFixed(2)}s`);
      }
    });
  }

  destroy(): void {
    this._stopPolling();
    this._activeDateranges.clear();
    this._dateranges = [];
  }
}
