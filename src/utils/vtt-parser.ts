export interface VTTCueData {
  start: number;
  end: number;
  text: string;
}

export function parseVTT(data: string): VTTCueData[] {
  const cues: VTTCueData[] = [];
  const lines = data.split('\n');
  let i = 0;

  // Skip WEBVTT header
  while (i < lines.length && !lines[i]!.includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line.includes('-->')) {
      const parts = line.split('-->');
      const start = parseVTTTime(parts[0]!.trim());
      const end = parseVTTTime(parts[1]!.trim());
      
      let text = '';
      i++;
      while (i < lines.length && lines[i]!.trim() !== '') {
        text += lines[i]!.trim() + '\n';
        i++;
      }
      
      cues.push({ start, end, text: text.trim() });
    }
    i++;
  }

  return cues;
}

function parseVTTTime(time: string): number {
  const parts = time.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0]!) * 3600;
    seconds += parseInt(parts[1]!) * 60;
    seconds += parseFloat(parts[2]!);
  } else {
    seconds += parseInt(parts[0]!) * 60;
    seconds += parseFloat(parts[1]!);
  }
  return seconds;
}
