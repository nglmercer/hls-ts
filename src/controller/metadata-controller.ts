import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { LevelDetails } from '../types/level';
import { Logger } from '../utils/logger';
import { SCTE35Decoder, type SCTE35Data } from '../utils/scte35';

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
  scte35Data?: SCTE35Data | null;
}

export class MetadataController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _dateranges: DateRange[] = [];
  private _inbandMetadata: Array<{ pts: number; data: any; active?: boolean }> = [];
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
      this._dateranges = (data.details.dateranges as DateRange[]).map(dr => {
        // Enrich with decoded SCTE-35 data if present
        if (!dr.scte35Data) {
          const scteBase64 = dr.scte35Cmd || dr.scte35Out || dr.scte35In;
          if (scteBase64) {
            dr.scte35Data = SCTE35Decoder.decode(scteBase64);
          }
        }
        return dr;
      });
      this._updateTimelineMapping(data.details);
    }
  };

  _onFragParsingMetadata = (data: { samples: Array<{ pts: number; data: any }> }): void => {
    // Collect in-band metadata samples (EMSGs, ID3s, etc)
    data.samples.forEach(sample => {
      // Avoid duplicates
      if (!this._inbandMetadata.some(s => s.pts === sample.pts && s.data.id === sample.data.id)) {
        this._inbandMetadata.push({ ...sample });
      }
    });
    // Keep list sorted by PTS
    this._inbandMetadata.sort((a, b) => a.pts - b.pts);
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
    this._pollTimer = setInterval(() => {
      if (this._dateranges.length === 0 && this._inbandMetadata.length === 0) return;
      this._checkDateranges();
    }, 500);
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

    // Check in-band metadata (one-shot events)
    const currentPts = currentTime * 90000;
    this._inbandMetadata.forEach(sample => {
      if (!sample.active && Math.abs(currentPts - sample.pts) < 45000) { // Within 500ms
        sample.active = true;
        this.hls.trigger(Events.METADATA_FOUND, sample.data);
        this.logger.log(`Found in-band metadata at ${currentTime.toFixed(2)}s`, sample.data);
      }
    });
  }

  destroy(): void {
    this._stopPolling();
    this._activeDateranges.clear();
    this._dateranges = [];
  }
}
