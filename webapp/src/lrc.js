export function parseLRC(content) {
  const lines = [];
  const pattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of content.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(pattern)];
    if (timestamps.length === 0) {
      continue;
    }

    const text = rawLine.replace(pattern, "").trim();
    if (!text) {
      continue;
    }

    for (const match of timestamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0").slice(0, 3)}`) : 0;
      lines.push({
        timestamp: (minutes * 60) + seconds + fraction,
        text
      });
    }
  }

  return lines.sort((lhs, rhs) => lhs.timestamp - rhs.timestamp);
}

export function captionIndexAt(time, captions) {
  if (!captions.length || !Number.isFinite(time)) {
    return null;
  }

  let low = 0;
  let high = captions.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (captions[mid].timestamp <= time) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60).toString().padStart(2, "0");
  const rest = (whole % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}
