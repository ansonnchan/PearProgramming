type EnvName = keyof ImportMetaEnv | string;

type UrlEnvOptions = {
  allowedProtocols: string[];
  aliases?: EnvName[];
  required?: boolean;
};

const ENV = import.meta.env as Record<string, string | boolean | undefined>;

export function getRequiredUrlEnv(name: EnvName, options: Omit<UrlEnvOptions, 'required'>) {
  const value = getUrlEnv(name, { ...options, required: true });
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

export function getOptionalUrlEnv(name: EnvName, options: Omit<UrlEnvOptions, 'required'>) {
  return getUrlEnv(name, { ...options, required: false }) ?? '';
}

export function logResolvedFrontendEnv(values: { apiUrl: string; stompUrl: string; yjsUrl: string }) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.info('[PearProgramming env]', {
    apiUrl: values.apiUrl,
    stompUrl: values.stompUrl,
    yjsUrl: values.yjsUrl || '<not configured>'
  });
}

function getUrlEnv(name: EnvName, options: UrlEnvOptions) {
  const names = [String(name), ...(options.aliases ?? []).map(String)];
  const found = names
    .map((envName) => ({ envName, rawValue: stringEnvValue(envName) }))
    .find((entry) => entry.rawValue !== undefined);

  if (!found) {
    if (options.required) {
      throw new Error(`Missing required environment variable ${names.join(' or ')}.`);
    }
    return null;
  }

  return normalizeAbsoluteUrlEnv(found.envName, found.rawValue ?? '', options.allowedProtocols);
}

function stringEnvValue(name: string) {
  const value = ENV[name];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeAbsoluteUrlEnv(name: string, rawValue: string, allowedProtocols: string[]) {
  const value = rawValue.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error(`${name} is empty.`);
  }

  if (/^VITE_[A-Z0-9_]+=/.test(value)) {
    throw new Error(`${name} value looks like "${value}". In Vercel, put only the URL in the value field.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL, received "${value}".`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${allowedProtocols.join(' or ')}, received "${parsed.protocol}".`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

function runUrlGenerationChecks() {
  const stomp = normalizeAbsoluteUrlEnv(
    'VITE_STOMP_URL',
    'https://pear-program-backend.onrender.com/ws',
    ['http:', 'https:']
  );
  if (stomp !== 'https://pear-program-backend.onrender.com/ws') {
    throw new Error(`STOMP URL normalization failed: ${stomp}`);
  }

  try {
    normalizeAbsoluteUrlEnv(
      'VITE_STOMP_URL',
      'VITE_STOMP_URL=https://pear-program-backend.onrender.com/ws',
      ['http:', 'https:']
    );
  } catch {
    return;
  }

  throw new Error('Malformed STOMP URL self-check failed.');
}

runUrlGenerationChecks();
