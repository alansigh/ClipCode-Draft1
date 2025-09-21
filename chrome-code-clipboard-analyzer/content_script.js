(function () {
  const STORAGE_KEY = 'cca_enabled';
  const API_KEY_STORAGE_KEY = 'cca_api_key';
  
  // AI Configuration - Set your API key here
  const AI_CONFIG = {
    apiKey: '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', // OpenRouter API key (embedded)
    provider: 'openrouter', // 'openrouter', 'openai', 'claude', or 'gemini'
    model: 'x-ai/grok-4-fast:free' // Prefer Grok 4 (fast, free tier) via OpenRouter
  };

  // Mask an API key for safe console logging
  function maskKey(k) {
    if (!k) return '';
    return k.length <= 8 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`;
  }

  // Log API configuration (masked) for debugging
  try {
    console.info('[CCA] AI provider:', AI_CONFIG.provider, '| model:', AI_CONFIG.model || 'x-ai/grok-4-fast:free', '| API key:', AI_CONFIG.apiKey ? maskKey(AI_CONFIG.apiKey) : 'missing');
    if (!AI_CONFIG.apiKey) {
      console.warn('[CCA] No API key configured. AI analysis will fail until a valid key is set.');
    }
  } catch (_) {}
  
  // Instructions:
  // 1. Get an API key from OpenRouter (https://openrouter.ai)
  // 2. Replace the apiKey above with your actual API key
  // 3. Reload the extension
  
  const STATE = {
    enabled: true,
    lastShownAt: 0
  };

  // Load persisted settings
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY, API_KEY_STORAGE_KEY], (res) => {
        if (res && typeof res[STORAGE_KEY] === 'boolean') {
          STATE.enabled = res[STORAGE_KEY];
        }
        const storedKey = (res && typeof res[API_KEY_STORAGE_KEY] === 'string') ? res[API_KEY_STORAGE_KEY] : '';
        if (storedKey) {
          AI_CONFIG.apiKey = storedKey;
        } else if (AI_CONFIG.apiKey) {
          try { chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: AI_CONFIG.apiKey }); } catch (_) {}
        }
      });
    }
  } catch (_) {
    // ignore
  }

  function isProbablyCode(text) {
    if (!text) return false;
    if (text.length < 10) return false;
    const lines = text.split(/\r?\n/);
    const avgLen = lines.reduce((a, b) => a + b.length, 0) / Math.max(1, lines.length);
    const codeSignals = /(\{|\}|;|=>|::|#include|using\s+namespace|<\/?\w+>|\b(def|class|return|if|for|while|switch|case|break|continue|try|catch|finally|import|export|package|func|public|private|static)\b)/;
    const indentedCount = lines.filter((l) => /^\s{2,}|\t/.test(l)).length;
    const manyIndented = indentedCount >= Math.max(1, Math.floor(lines.length * 0.3));
    return codeSignals.test(text) || manyIndented || (avgLen > 25 && lines.length >= 2);
  }

  function guessLanguage(text) {
    const t = text || '';
    const scores = Object.create(null);
    const add = (lang, pts) => { scores[lang] = (scores[lang] || 0) + pts; };
    const has = (re) => re.test(t);

    // JSON (strict-ish)
    if (/^[\s\r\n]*[\{\[][\s\S]*[\}\]][\s\r\n]*$/.test(t) && !/[;=]/.test(t)) {
      try { JSON.parse(t); add('json', 10); } catch (_) { /* ignore */ }
    }

    // HTML & JSX
    if (/<[a-zA-Z][\s\S]*>/.test(t) && /<\/[a-zA-Z]+>/.test(t)) add('html', 3);
    if (/<[A-Z][A-Za-z0-9]*\b/.test(t) && /import\s+React/.test(t)) add('jsx', 6);
    if (/className=/.test(t) && /<\w+/.test(t)) add('jsx', 3);

    // CSS & SCSS
    if (/[#.a-zA-Z0-9][^{\n]+\{\s*[a-z-]+\s*:\s*[^;]+;/.test(t)) add('css', 5);
    if (/@media|@keyframes|@import/.test(t)) add('css', 2);
    if (/\$[a-zA-Z][\w-]*\s*:/.test(t) || /@mixin|@include/.test(t)) add('scss', 4);

    // TypeScript signals (enhanced)
    if (/\binterface\s+\w+/.test(t)) add('typescript', 6);
    if (/\benum\s+\w+/.test(t)) add('typescript', 4);
    if (/:\s*(string|number|boolean|any|unknown|never|void|Array<|Record<|Readonly<|Promise<)/.test(t)) add('typescript', 5);
    if (/\bimplements\s+\w+/.test(t)) add('typescript', 3);
    if (/\btype\s+\w+\s*=/.test(t)) add('typescript', 4);
    if (/<[A-Z]\w*\s*=/.test(t) && /\bProps\b/.test(t)) add('typescript', 3);
    if (/\bas\s+(const|any|string|number)\b/.test(t)) add('typescript', 2);

    // JavaScript signals (enhanced)
    if (/\b(function|const|let|var)\b/.test(t)) add('javascript', 2);
    if (/=>/.test(t)) add('javascript', 2);
    if (/console\.(log|error|warn|info)/.test(t)) add('javascript', 2);
    if (/\bimport\s+.*from\s+['"]/.test(t) || /\brequire\(['"]/.test(t)) add('javascript', 3);
    if (/\bexport\s+(default|const|function|class)\b/.test(t)) add('javascript', 3);
    if (/\b(async|await)\b/.test(t)) add('javascript', 2);
    if (/\bnew\s+\w+\s*\(/.test(t)) add('javascript', 1);

    // Python (enhanced)
    if (/\bdef\s+\w+\s*\([^)]*\)\s*:/.test(t)) add('python', 6);
    if (/\b(import\s+\w+|from\s+\w+\s+import\b)/.test(t)) add('python', 3);
    if (/\bprint\(/.test(t)) add('python', 2);
    if (/\bclass\s+\w+\s*\(/.test(t)) add('python', 3);
    if (/\bif\s+__name__\s*==\s*['"]__main__['"]/.test(t)) add('python', 5);
    if (/\b(len|range|enumerate|zip)\s*\(/.test(t)) add('python', 2);
    if (/\bwith\s+\w+/.test(t) || /\btry:\s*$/.test(t)) add('python', 2);
    if (/^\s*#\s*!.*python/m.test(t)) add('python', 4);

    // Go (enhanced)
    if (/\bpackage\s+\w+/.test(t) && /\bfunc\b/.test(t)) add('go', 8);
    if (/\bimport\s+\([\s\S]*\)/.test(t)) add('go', 3);
    if (/\bfmt\.Print/.test(t)) add('go', 3);
    if (/\bmake\(\[\]\w+/.test(t) || /\bappend\(/.test(t)) add('go', 2);
    if (/\bgo\s+func\(/.test(t) || /\bdefer\b/.test(t)) add('go', 3);
    if (/\bvar\s+\w+\s+\w+/.test(t)) add('go', 2);

    // Java (enhanced)
    if (/\bpublic\s+(class|interface)\b/.test(t)) add('java', 5);
    if (/System\.out\.print(ln)?/.test(t)) add('java', 3);
    if (/\bpublic\s+static\s+void\s+main\s*\(/.test(t)) add('java', 6);
    if (/\b@Override|@Deprecated|@SuppressWarnings/.test(t)) add('java', 3);
    if (/\bArrayList|HashMap|HashSet/.test(t)) add('java', 2);
    if (/\bthrows\s+\w+Exception/.test(t)) add('java', 2);

    // C# (enhanced)
    if (/\busing\s+System/.test(t)) add('csharp', 4);
    if (/\bnamespace\s+[A-Z]\w*/.test(t)) add('csharp', 3);
    if (/Console\.Write(Line)?/.test(t)) add('csharp', 3);
    if (/\b(public|private|protected)\s+(static\s+)?\w+\s+\w+\s*\(/.test(t)) add('csharp', 2);
    if (/\[\w+\]/.test(t) && /\bclass\b/.test(t)) add('csharp', 2);

    // C++ (enhanced)
    if (/^\s*#include\s+<.+?>/m.test(t)) add('cpp', 5);
    if (/\bstd::\w+/.test(t)) add('cpp', 4);
    if (/\busing\s+namespace\s+std\b/.test(t)) add('cpp', 3);
    if (/\btemplate\s*<[^>]+>/.test(t)) add('cpp', 3);
    if (/\bcout\s*<</.test(t) || /\bcin\s*>>/.test(t)) add('cpp', 3);
    if (/\bvoid\s+\w+\s*\(/.test(t) || /\bint\s+main\s*\(/.test(t)) add('cpp', 2);

    // PHP (enhanced)
    if (/<\?php\b/.test(t)) add('php', 8);
    if (/\$\w+/.test(t) && /->/.test(t)) add('php', 3);
    if (/\becho\b|\bprint\b/.test(t) && /\$/.test(t)) add('php', 2);

    // Ruby (enhanced)
    if ((/\bdef\s+self\.\w+/.test(t) || /\bdef\s+\w+/.test(t)) && /\bend\b/.test(t)) add('ruby', 5);
    if (/\bputs\b|\bp\s/.test(t)) add('ruby', 2);
    if (/\bclass\s+\w+/.test(t) && /\bend\b/.test(t)) add('ruby', 3);
    if (/\brequire\s+['"]\w+['"]/.test(t)) add('ruby', 2);

    // Rust (enhanced)
    if (/\bfn\s+\w+\s*\(/.test(t)) add('rust', 5);
    if (/\blet\s+mut\b/.test(t) || /::\w+::/.test(t) || /println!\s*\(/.test(t)) add('rust', 3);
    if (/\bmatch\s+\w+/.test(t) || /\bimpl\s+\w+/.test(t)) add('rust', 3);
    if (/\buse\s+std::/.test(t) || /\b#\[derive\(/.test(t)) add('rust', 2);

    // Kotlin (enhanced)
    if (/\bfun\s+\w+\s*\(/.test(t) && (/\bval\b|\bvar\b/.test(t))) add('kotlin', 4);
    if (/\bdata\s+class\b/.test(t)) add('kotlin', 4);
    if (/\bwhen\s*\(/.test(t) || /\bnullable\?/.test(t)) add('kotlin', 2);

    // Swift (enhanced)
    if (/\bimport\s+Foundation\b/.test(t) || /\bfunc\s+\w+\s*\(/.test(t)) add('swift', 3);
    if ((/\blet\b|\bvar\b/.test(t)) && /\bprint\s*\(/.test(t)) add('swift', 2);
    if (/\bguard\s+let/.test(t) || /\bif\s+let/.test(t)) add('swift', 3);

    // Scala (enhanced)
    if (/\bobject\s+\w+/.test(t) || /\bcase\s+class\b/.test(t) || /\bimplicit\b/.test(t)) add('scala', 3);
    if (/\bdef\s+\w+\s*\(/.test(t) && /:\s*\w+\s*=/.test(t)) add('scala', 2);

    // Shell (enhanced)
    if (/^#!.*\b(bash|sh|zsh)\b/m.test(t)) add('shell', 8);
    if (/(^|\n)\s*(echo|grep|awk|sed|export|readonly|trap|set\s+-[a-z]+)/.test(t) && /\n/.test(t)) add('shell', 4);
    if (/\bfor\s+\w+\s+in\b/.test(t) && /\bdo\b[\s\S]*\bdone\b/.test(t)) add('shell', 3);
    if (/\$\{[^}]+\}|\$\w+/.test(t)) add('shell', 2);
    if (/\|\s*\w+/.test(t) || /&&|\|\|/.test(t)) add('shell', 1);

    // SQL (enhanced)
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(t) && /\bFROM\b/i.test(t)) add('sql', 6);
    if (/\b(JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/i.test(t)) add('sql', 3);
    if (/\b(VARCHAR|INT|DECIMAL|DATETIME|PRIMARY\s+KEY|FOREIGN\s+KEY)\b/i.test(t)) add('sql', 2);

    // YAML (enhanced)
    if (/^\s*---/m.test(t) || /^\s*[\w\-]+\s*:\s+.+/m.test(t)) add('yaml', 3);
    if (/^\s*-\s+\w+:/m.test(t)) add('yaml', 2);

    // Dockerfile
    if (/^\s*(FROM|RUN|COPY|ADD|EXPOSE|CMD|ENTRYPOINT)\b/m.test(t)) add('dockerfile', 5);

    // Markdown
    if (/^\s*#+\s+/.test(t) || /\*\*\w+\*\*/.test(t) || /```\w*/.test(t)) add('markdown', 3);

    // XML
    if (/<\?xml/.test(t) || (/<\w+[^>]*>/.test(t) && /<\/\w+>/.test(t) && !/html/i.test(t))) add('xml', 4);

    // Prefer TS over JS if strong TS signals present
    if ((scores.typescript || 0) >= 5) {
      scores.javascript = Math.max(0, (scores.javascript || 0) - 3);
    }

    // Pick the best scoring language
    let best = 'unknown';
    let bestScore = 0;
    for (const [lang, sc] of Object.entries(scores)) {
      if (sc > bestScore) { best = lang; bestScore = sc; }
    }
    return best;
  }

  function summarize(text, lang) {
    const lineCount = text.split(/\r?\n/).length;
    const hasClass = /\bclass\s+\w+/.test(text);
    const hasFunc = /\bfunction\b|\bdef\b|\bfunc\b|\)\s*=>/.test(text);
    const hasImport = /\b(import|from|require\(|using\s|#include|package)\b/.test(text);
    const parts = [];
    parts.push(`Language: ${lang}`);
    parts.push(`Lines: ${lineCount}`);
    if (hasClass) parts.push('Defines a class');
    if (hasFunc) parts.push('Includes one or more functions');
    if (hasImport) parts.push('Has dependencies/imports');
    return parts.join(' • ');
  }

  function extractFunctionInfo(text, lang) {
    const info = [];
    try {
      if (lang === 'javascript') {
        const re = /(function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\))|(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*\(([^)]*)\)\s*=>/g;
        let m;
        while ((m = re.exec(text))) {
          const name = m[2] || m[4] || 'anonymous';
          const params = (m[3] || m[5] || '').split(',').map(s => s.trim()).filter(Boolean);
          info.push({ name, params });
        }
      } else if (lang === 'python') {
        const re = /def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*:/g;
        let m;
        while ((m = re.exec(text))) {
          const name = m[1];
          const params = (m[2] || '').split(',').map(s => s.split('=')[0].trim()).filter(Boolean);
          info.push({ name, params });
        }
      } else if (lang === 'go') {
        const re = /func\s+(\w+)\s*\(([^)]*)\)/g;
        let m;
        while ((m = re.exec(text))) {
          const name = m[1];
          // Params are typed; we only count them
          const params = (m[2] || '').split(',').map(s => s.trim()).filter(Boolean);
          info.push({ name, params });
        }
      }
    } catch (_) {}
    return info;
  }

  function sampleTests(text, lang) {
    const tests = [];
    const funcs = extractFunctionInfo(text, lang);
    if (funcs.length) {
      for (const f of funcs.slice(0, 3)) {
        const p = f.params;
        const args = p.map((_, i) => (i === 0 ? 0 : i === 1 ? 1 : "''")).join(', ');
        if (lang === 'javascript') {
          tests.push(`// Happy path\n${f.name}(${args});`);
          tests.push(`// Edge cases\n${f.name}(null);\n${f.name}('');`);
          tests.push(`// Large input\n${f.name}(Array(1000).fill(1));`);
        } else if (lang === 'python') {
          tests.push(`# Happy path\n${f.name}(${args})`);
          tests.push(`# Edge cases\n${f.name}(None)\n${f.name}("")`);
          tests.push(`# Large input\n${f.name}([1]*1000)`);
        } else if (lang === 'go') {
          tests.push(`// Consider writing table-driven tests for ${f.name}`);
          tests.push(`// Edge cases: empty/zero values, nil pointers, Unicode strings`);
        }
      }
    } else {
      tests.push('Generic tests: empty input, null/None, large inputs, Unicode, unexpected types');
      tests.push('Property-like checks: idempotence, reversibility (if applicable), monotonicity');
    }
    return tests;
  }

  function questions(text, lang) {
    return [
      'What are the expected input and output types?',
      'What are edge cases (empty, null/None, large inputs, Unicode, time zones)?',
      'What is the algorithmic complexity? Can it be improved?',
      'Are there side effects (I/O, globals, DOM, network)?',
      'How are errors handled? Are exceptions propagated or swallowed?',
      'Are there security concerns (injection, unsafe eval, path traversal)?',
      `Are there language-specific pitfalls to avoid in ${lang}?`
    ];
  }

  // Real AI Service with OpenAI API integration
  class AIService {
    constructor() {}

    async analyzeCode(code, language) {
      // Always use the API; no mock implementation
      return await this.callOpenAI(code, language);
    }

    async callOpenAI(code, language) {
      const prompt = this.buildPrompt(code, language);

      // If no API key is configured, skip network calls and fail fast
      if (!AI_CONFIG.apiKey) {
        throw new Error('No API key configured');
      }

      const usingOpenRouter = (AI_CONFIG.provider === 'openrouter') || /^sk-or-/.test(AI_CONFIG.apiKey || '');
      const endpoint = usingOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

      // Optimize for efficiency: try Grok first, then a lightweight router
      const modelsToTry = usingOpenRouter
        ? Array.from(new Set([
            AI_CONFIG.model || 'x-ai/grok-4-fast:free',
            'openrouter/auto'
          ]))
        : Array.from(new Set([
            AI_CONFIG.model || 'gpt-4o-mini'
          ]));

      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        try {
          try {
            console.info('[CCA] Calling chat API:', endpoint, '| model:', model, '| key:', maskKey(AI_CONFIG.apiKey));
          } catch (_) {}

          const headers = {
            'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
          };
          if (usingOpenRouter) {
            headers['X-Title'] = 'ClipCode Analyst';
            try { headers['HTTP-Referer'] = location.origin; } catch (_) {}
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'user', content: prompt }
              ],
              response_format: { type: 'json_object' },
              max_tokens: 900,
              temperature: 0.2,
              top_p: 0.9,
              presence_penalty: 0,
              frequency_penalty: 0
            })
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const message = error.error?.message || `HTTP ${response.status}: ${response.statusText}`;
            throw new Error(message);
          }

          const data = await response.json();
          const aiResponse = data.choices?.[0]?.message?.content ?? '';
          const parsed = await this.parseAIResponse(aiResponse, code, language);
          parsed.__meta = { provider: usingOpenRouter ? 'openrouter' : 'openai', endpoint, model };
          this.lastUsedModel = model;
          return parsed;
        } catch (err) {
          const isLast = i === modelsToTry.length - 1;
          console.warn(`[CCA] Model '${model}' failed:`, err?.message || err);
          if (isLast) {
            console.error('Chat API call failed:', err);
            throw err;
          }
          // Otherwise, try the next model
        }
      }

      // Should not reach here; fallback just in case
      return this.generateComprehensiveAnalysis(code, language);
    }

    buildPrompt(code, language) {
      return `You are analyzing user-copied ${language} code.
Return ONLY strict, minified JSON. No markdown/code fences, no comments, no trailing commas, use double quotes for all keys/strings.

Schema:
{"overview":string,"codeQuality":{"score":number,"grade":string,"factors":{"readability":string,"maintainability":string,"complexity":string}},"suggestions":string[],"securityAnalysis":{"issues":string[],"score":string},"performanceInsights":string[],"bestPractices":string[],"learningPoints":string[],"patterns":{"patterns":string[],"description":string},"lineAnalysis":[{"lineNumber":number,"insights":string[]}],"quiz":[{"question":string,"options":string[],"correct":number,"explanation":string}]}

Overview must be 2-4 sentences focused on what the code actually does: inputs, outputs/returns, side effects (I/O/DOM/network), and core algorithm/flow.
Use the exact line numbers from the provided code. If unsure about a field, return an empty array or a sensible default.

Code to analyze:\n\`\`\`${language}\n${code}\n\`\`\``;
    }

    async parseAIResponse(response, code, language) {
      // Robust JSON extraction and repair
      const stripCodeFences = (s) => {
        if (!s) return s;
        return s.replace(/```json\s*[\r\n]?([\s\S]*?)```/gi, '$1')
                .replace(/```\s*[\r\n]?([\s\S]*?)```/g, '$1');
      };
      const stripComments = (s) => s
        .replace(/\/\/.*(?=\n|$)/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const stripInvisible = (s) => s
        .replace(/[\u200B-\u200D\uFEFF]/g, '');
      const extractCurly = (s) => {
        const first = s.indexOf('{');
        const last = s.lastIndexOf('}');
        if (first === -1 || last === -1 || last <= first) return null;
        return s.slice(first, last + 1);
      };
      const normalizeQuotes = (s) => s
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      const removeTrailingCommas = (s) => s.replace(/,\s*([}\]])/g, '$1');

      try {
        let text = String(response || '');
        text = stripCodeFences(text);
        text = stripComments(text);
        text = stripInvisible(text);
        text = normalizeQuotes(text);
        let jsonLike = extractCurly(text) || text;
        jsonLike = removeTrailingCommas(jsonLike);
        const parsed = JSON.parse(jsonLike);
        return this.validateAIResponse(parsed, code, language);
      } catch (error) {
        try {
          // Second attempt: aggressively strip non-JSON before/after braces
          let text = String(response || '');
          text = stripCodeFences(text);
          text = stripComments(text);
          text = stripInvisible(text);
          text = normalizeQuotes(text);
          const jsonLike = extractCurly(text);
          if (jsonLike) {
            const repaired = removeTrailingCommas(jsonLike);
            const parsed = JSON.parse(repaired);
            return this.validateAIResponse(parsed, code, language);
          }
        } catch (e2) {
          console.warn('Failed to parse AI response as JSON:', e2);
        }
        // Third attempt: ask the model to repair to strict JSON
        try {
          const strict = await this.repairJsonWithModel(response, code, language);
          return this.validateAIResponse(strict, code, language);
        } catch (e3) {
          console.warn('Failed to repair AI response to JSON:', e3);
          // As a final skeleton: use the raw text for overview only
          return this.validateAIResponse({ overview: String(response || '') }, code, language);
        }
        // Fallback: create structured response from text returned by AI (no local mock)
        return this.createFallbackResponse(response, code, language);
      }
    }

    validateAIResponse(aiResponse, code, language) {
      // Ensure all required fields exist
      const safeLineAnalysis = Array.isArray(aiResponse.lineAnalysis)
        ? aiResponse.lineAnalysis
            .filter(it => typeof it?.lineNumber === 'number')
            .map(it => ({
              lineNumber: it.lineNumber,
              insights: Array.isArray(it.insights) ? it.insights.filter(s => typeof s === 'string') : []
            }))
        : null;

      const safeQuiz = Array.isArray(aiResponse.quiz)
        ? aiResponse.quiz
            .filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && typeof q.correct === 'number')
            .map(q => ({
              question: q.question,
              options: q.options.map(o => String(o)),
              correct: q.correct,
              explanation: typeof q.explanation === 'string' ? q.explanation : ''
            }))
        : null;

      return {
        overview: aiResponse.overview || `This ${language} code performs various operations.`,
        codeQuality: aiResponse.codeQuality || {
          score: 75,
          grade: 'Good',
          factors: { readability: 'Medium', maintainability: 'Medium', complexity: 'Medium' }
        },
        suggestions: aiResponse.suggestions || ['Consider adding comments for better readability'],
        securityAnalysis: aiResponse.securityAnalysis || { issues: [], score: 'Good' },
        performanceInsights: aiResponse.performanceInsights || ['Performance looks good for this code snippet'],
        bestPractices: aiResponse.bestPractices || ['Follow language-specific best practices'],
        learningPoints: aiResponse.learningPoints || ['This code demonstrates programming concepts'],
        patterns: aiResponse.patterns || { patterns: [], description: 'Uses basic programming constructs' },
        lineAnalysisAI: safeLineAnalysis,
        quizAI: safeQuiz
      };
    }

    createFallbackResponse(response, code, language) {
      return {
        overview: `AI Analysis: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`,
        codeQuality: {
          score: 75,
          grade: 'Good',
          factors: { readability: 'Medium', maintainability: 'Medium', complexity: 'Medium' }
        },
        suggestions: ['AI analysis completed - see overview for details'],
        securityAnalysis: { issues: [], score: 'Good' },
        performanceInsights: ['AI analysis completed - see overview for details'],
        bestPractices: ['Follow language-specific best practices'],
        learningPoints: ['Review the AI analysis for learning opportunities'],
        patterns: { patterns: [], description: 'Uses basic programming constructs' }
      };
    }

    generateComprehensiveAnalysis(code, language) {
      const lines = code.split('\n');
      const complexity = this.assessComplexity(code);
      const patterns = this.identifyPatterns(code, language);
      const security = this.analyzeSecurity(code);
      const performance = this.analyzePerformance(code, language);
      
      return {
        overview: this.generateOverview(code, language, lines.length, complexity, patterns),
        codeQuality: this.assessCodeQuality(code, language),
        suggestions: this.generateSuggestions(code, language),
        securityAnalysis: security,
        performanceInsights: performance,
        bestPractices: this.generateBestPractices(language),
        learningPoints: this.generateLearningPoints(code, language),
        patterns: patterns
      };
    }

    generateOverview(code, language, lineCount, complexity, patterns) {
      const hasFunctions = /\b(function|def|func|fn)\s+\w+/.test(code);
      const hasClasses = /\bclass\s+\w+/.test(code);
      const hasImports = /\b(import|from|require|using|#include)\b/.test(code);
      
      let overview = `This ${language} code snippet contains ${lineCount} lines with ${complexity} complexity. `;
      
      if (hasClasses) overview += "It defines one or more classes. ";
      if (hasFunctions) overview += "It includes function definitions. ";
      if (hasImports) overview += "It has external dependencies. ";
      
      // Add pattern description
      overview += patterns.description;
      
      return overview;
    }

    assessComplexity(code) {
      const cyclomaticIndicators = (code.match(/\b(if|for|while|switch|case|catch|&&|\|\|)\b/g) || []).length;
      if (cyclomaticIndicators > 10) return 'high';
      if (cyclomaticIndicators > 5) return 'medium';
      return 'low';
    }

    identifyPatterns(code, language) {
      const patterns = [];
      if (/\bclass\s+\w+/.test(code)) patterns.push('Object-Oriented Programming');
      if (/\bfunction\s+\w+|\w+\s*=>/.test(code)) patterns.push('Functional Programming');
      if (/\basync\b|\bawait\b|Promise/.test(code)) patterns.push('Asynchronous Programming');
      if (/\btry\s*\{[\s\S]*catch/.test(code)) patterns.push('Error Handling');
      if (/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(code)) patterns.push('Iterative Logic');
      if (/\bmap\s*\(|\bfilter\s*\(|\breduce\s*\(/.test(code)) patterns.push('Array Processing');
      if (/\bconst\b|\blet\b/.test(code)) patterns.push('Modern JavaScript');
      
      return {
        patterns: patterns,
        description: patterns.length > 0 ? `Uses ${patterns.join(', ')} patterns.` : 'Uses basic programming constructs.'
      };
    }

    assessCodeQuality(code, language) {
      const lines = code.split('\n');
      const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
      const hasComments = /\/\/|\/\*|#/.test(code);
      const complexity = this.assessComplexity(code);
      const hasErrorHandling = /\btry\s*\{|\bcatch\s*\(/.test(code);
      const hasDocumentation = /\/\*\*[\s\S]*?\*\//.test(code);
      
      let score = 100;
      if (avgLineLength > 100) score -= 10;
      if (!hasComments && lines.length > 10) score -= 15;
      if (complexity === 'high') score -= 20;
      else if (complexity === 'medium') score -= 10;
      if (!hasErrorHandling && lines.length > 20) score -= 10;
      if (!hasDocumentation && lines.length > 30) score -= 5;
      
      return {
        score: Math.max(0, score),
        grade: score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs Improvement',
        factors: {
          avgLineLength: avgLineLength.toFixed(1),
          hasComments,
          complexity,
          hasErrorHandling,
          hasDocumentation
        }
      };
    }

    generateSuggestions(code, language) {
      const suggestions = [];
      
      if (language === 'javascript') {
        if (code.includes('var ')) suggestions.push('Consider using const/let instead of var for better scoping');
        if (code.includes('==') && !code.includes('===')) suggestions.push('Use strict equality (===) instead of loose equality (==)');
        if (/for\s*\([^)]*\.length[^)]*\)/.test(code)) suggestions.push('Cache array length in loops for better performance');
        if (!/\btry\s*\{/.test(code) && /fetch\(|axios\.|\.get\(|\.post\(/.test(code)) suggestions.push('Add error handling for network requests');
      }
      
      if (language === 'python') {
        if (!code.includes('def ') && code.length > 100) suggestions.push('Consider breaking long scripts into functions');
        if (code.includes('import *')) suggestions.push('Avoid wildcard imports; import specific modules');
        if (!code.includes('if __name__') && code.includes('def ')) suggestions.push('Add if __name__ == "__main__" guard for script execution');
      }
      
      if (code.split('\n').some(line => line.length > 120)) {
        suggestions.push('Some lines exceed 120 characters; consider breaking them up');
      }
      
      if (!/\/\/|\/\*|#/.test(code) && code.length > 200) {
        suggestions.push('Consider adding comments to explain complex logic');
      }
      
      return suggestions.length > 0 ? suggestions : ['Code looks clean! No immediate suggestions.'];
    }

    analyzeSecurity(code) {
      const issues = [];
      if (/\beval\s*\(/.test(code)) issues.push('⚠️ eval() detected - potential code injection risk');
      if (/innerHTML\s*=/.test(code)) issues.push('⚠️ innerHTML usage - consider textContent for safety');
      if (/document\.write/.test(code)) issues.push('⚠️ document.write() is deprecated and unsafe');
      if (/\$\{[^}]*\}/.test(code) && /sql|query/i.test(code)) issues.push('⚠️ Potential SQL injection risk with template literals');
      if (/\bpassword\s*=|\bsecret\s*=|\bkey\s*=/.test(code)) issues.push('⚠️ Hardcoded credentials detected');
      
      return {
        issues: issues,
        score: issues.length === 0 ? 'Good' : issues.length < 3 ? 'Fair' : 'Needs Attention'
      };
    }

    analyzePerformance(code, language) {
      const insights = [];
      
      if (/for\s*\([^)]*\)\s*\{[\s\S]*for\s*\([^)]*\)/.test(code)) {
        insights.push('💡 Nested loops detected - O(n²) complexity, consider optimization');
      }
      if (/\.map\s*\([^)]*\)\.filter\s*\(/.test(code)) {
        insights.push('💡 Chained map().filter() - consider using reduce() for better performance');
      }
      if (language === 'javascript' && /new Date\(\)/.test(code)) {
        insights.push('💡 Multiple Date() calls - consider caching timestamp');
      }
      if (/\bconsole\.log\b/.test(code)) {
        insights.push('💡 Remove console.log statements in production code');
      }
      
      return insights.length > 0 ? insights : ['Performance looks good for this code snippet.'];
    }

    generateBestPractices(language) {
      const practices = {
        javascript: [
          'Use const by default, let when reassignment needed',
          'Always handle Promise rejections',
          'Use descriptive variable names',
          'Keep functions small and focused',
          'Use template literals instead of string concatenation'
        ],
        python: [
          'Follow PEP 8 style guidelines',
          'Use list comprehensions when appropriate',
          'Handle exceptions properly',
          'Write docstrings for functions',
          'Use type hints for better code clarity'
        ],
        go: [
          'Handle all errors explicitly',
          'Use gofmt for consistent formatting',
          'Keep interfaces small',
          'Use meaningful package names',
          'Follow Go naming conventions'
        ],
        java: [
          'Follow naming conventions',
          'Use appropriate access modifiers',
          'Handle checked exceptions',
          'Prefer composition over inheritance',
          'Use StringBuilder for string concatenation'
        ]
      };
      
      return practices[language] || [
        'Follow language-specific style guidelines',
        'Write readable, self-documenting code',
        'Test your code thoroughly',
        'Handle edge cases and errors',
        'Use meaningful variable and function names'
      ];
    }

    generateLearningPoints(code, language) {
      const points = [];
      
      if (/\bif\s*\(/.test(code)) points.push('Conditional statements control program flow');
      if (/\bfor\s*\(|\bwhile\s*\(/.test(code)) points.push('Loops allow repetitive task execution');
      if (/\bfunction\s+\w+|\w+\s*=>/.test(code)) points.push('Functions encapsulate reusable logic');
      if (/\bclass\s+\w+/.test(code)) points.push('Classes define object blueprints in OOP');
      if (/\btry\s*\{/.test(code)) points.push('Exception handling manages runtime errors');
      if (/\bconst\b|\blet\b/.test(code)) points.push('Modern variable declarations provide better scoping');
      if (/\bmap\s*\(|\bfilter\s*\(/.test(code)) points.push('Array methods provide functional programming patterns');
      
      return points.length > 0 ? points : ['This code demonstrates basic programming concepts.'];
    }
  }

  // Ask the model to repair invalid JSON into strict JSON
  AIService.prototype.repairJsonWithModel = async function(rawText, code, language) {
    const usingOpenRouter = (AI_CONFIG.provider === 'openrouter') || /^sk-or-/.test(AI_CONFIG.apiKey || '');
    const endpoint = usingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    // Prefer auto router for repair to maximize strict JSON compliance
    const model = usingOpenRouter ? 'openrouter/auto' : (AI_CONFIG.model || 'gpt-4o-mini');

    const headers = {
      'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
      'Content-Type': 'application/json'
    };
    if (usingOpenRouter) {
      headers['X-Title'] = 'ClipCode Analyst';
      try { headers['HTTP-Referer'] = location.origin; } catch (_) {}
    }

    const schema = '{"overview":string,"codeQuality":{"score":number,"grade":string,"factors":{"readability":string,"maintainability":string,"complexity":string}},"suggestions":string[],"securityAnalysis":{"issues":string[],"score":string},"performanceInsights":string[],"bestPractices":string[],"learningPoints":string[],"patterns":{"patterns":string[],"description":string},"lineAnalysis":[{"lineNumber":number,"insights":string[]}],"quiz":[{"question":string,"options":string[],"correct":number,"explanation":string}]}'

    const prompt = `Return ONLY strict, minified JSON (no code fences) that matches this schema: ${schema}.
Fix the following model output into valid JSON. If a field is missing, provide a sensible default (empty arrays/strings where appropriate). Do not include any commentary.

RAW OUTPUT:\n${rawText}`;

    const body = {
      model,
      messages: [ { role: 'user', content: prompt } ],
      response_format: { type: 'json_object' },
      max_tokens: 700,
      temperature: 0.0
    };

    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    try {
      // Try strict parse first
      return JSON.parse(content);
    } catch (_) {
      // Attempt simple repairs similar to main parser
      const stripCodeFences = (s) => s.replace(/```json\s*[\r\n]?([\s\S]*?)```/gi, '$1').replace(/```\s*[\r\n]?([\s\S]*?)```/g, '$1');
      const extractCurly = (s) => { const f = s.indexOf('{'); const l = s.lastIndexOf('}'); return (f !== -1 && l !== -1 && l > f) ? s.slice(f, l + 1) : null; };
      const removeTrailingCommas = (s) => s.replace(/,\s*([}\]])/g, '$1');
      let t = String(content || '');
      t = stripCodeFences(t);
      const jsonLike = extractCurly(t) || t;
      const repaired = removeTrailingCommas(jsonLike);
      return JSON.parse(repaired);
    }
  };

  const aiService = new AIService();

  // Quiz Generation System
  class QuizGenerator {
    constructor() {
      this.questionTypes = ['syntax', 'output', 'concept', 'debugging', 'optimization'];
    }

    generateQuiz(code, language) {
      const questions = [];
      
      // Generate different types of questions
      questions.push(...this.generateSyntaxQuestions(code, language));
      questions.push(...this.generateOutputQuestions(code, language));
      questions.push(...this.generateConceptQuestions(code, language));
      questions.push(...this.generateDebuggingQuestions(code, language));
      questions.push(...this.generateOptimizationQuestions(code, language));
      
      // Shuffle and limit to 5 questions
      return this.shuffleArray(questions).slice(0, 5).map((q, index) => ({ ...q, id: index + 1 }));
    }

    generateSyntaxQuestions(code, language) {
      const questions = [];
      
      if (language === 'javascript') {
        if (code.includes('const') || code.includes('let') || code.includes('var')) {
          questions.push({
            type: 'syntax',
            question: 'Which keyword should you prefer for variable declarations that won\'t be reassigned?',
            options: ['var', 'let', 'const', 'define'],
            correct: 2,
            explanation: 'const should be used for variables that won\'t be reassigned, as it prevents accidental modifications and makes code more predictable.'
          });
        }
        
        if (code.includes('===') || code.includes('==')) {
          questions.push({
            type: 'syntax',
            question: 'What is the difference between == and === in JavaScript?',
            options: [
              'No difference, they are identical',
              '=== performs type coercion, == does not',
              '== performs type coercion, === does not',
              '=== is faster than =='
            ],
            correct: 2,
            explanation: '== performs type coercion before comparison, while === checks both value and type without coercion.'
          });
        }
      }
      
      if (language === 'python') {
        if (code.includes('def ')) {
          questions.push({
            type: 'syntax',
            question: 'What character is used to define a code block in Python?',
            options: ['Curly braces {}', 'Square brackets []', 'Indentation', 'Semicolons ;'],
            correct: 2,
            explanation: 'Python uses indentation to define code blocks, making the code structure visually clear.'
          });
        }
      }
      
      return questions;
    }

    generateOutputQuestions(code, language) {
      const questions = [];
      
      // Simple fibonacci example
      if (code.includes('fibonacci') && language === 'javascript') {
        questions.push({
          type: 'output',
          question: 'What will fibonacci(5) return?',
          options: ['3', '5', '8', '13'],
          correct: 1,
          explanation: 'fibonacci(5) = fibonacci(4) + fibonacci(3) = 3 + 2 = 5. The Fibonacci sequence: 0, 1, 1, 2, 3, 5, 8...'
        });
      }
      
      // Simple loop examples
      if (/for\s*\(.*i.*<.*\d+.*\)/.test(code)) {
        const match = code.match(/i\s*<\s*(\d+)/);
        if (match) {
          const limit = parseInt(match[1]);
          questions.push({
            type: 'output',
            question: `How many times will a loop with condition 'i < ${limit}' execute (starting from i = 0)?`,
            options: [(limit-1).toString(), limit.toString(), (limit+1).toString(), (limit*2).toString()],
            correct: 1,
            explanation: `The loop runs from i = 0 to i = ${limit-1}, executing exactly ${limit} times.`
          });
        }
      }
      
      return questions;
    }

    generateConceptQuestions(code, language) {
      const questions = [];
      
      if (code.includes('async') || code.includes('await')) {
        questions.push({
          type: 'concept',
          question: 'What is the primary benefit of using async/await?',
          options: [
            'Makes code run faster',
            'Handles asynchronous operations in a synchronous-looking way',
            'Automatically handles all errors',
            'Reduces memory usage'
          ],
          correct: 1,
          explanation: 'async/await makes asynchronous code easier to read and write by allowing you to write it in a more synchronous style.'
        });
      }
      
      if (/\bclass\s+\w+/.test(code)) {
        questions.push({
          type: 'concept',
          question: 'What programming paradigm does the \'class\' keyword primarily support?',
          options: ['Functional Programming', 'Object-Oriented Programming', 'Procedural Programming', 'Logic Programming'],
          correct: 1,
          explanation: 'Classes are a fundamental concept in Object-Oriented Programming, allowing you to create objects with properties and methods.'
        });
      }
      
      return questions;
    }

    generateDebuggingQuestions(code, language) {
      const questions = [];
      
      if (code.includes('console.log')) {
        questions.push({
          type: 'debugging',
          question: 'What is console.log primarily used for?',
          options: ['Error handling', 'Debugging and logging', 'User interface', 'Data storage'],
          correct: 1,
          explanation: 'console.log is used for debugging by printing values to the browser console, helping developers understand program flow.'
        });
      }
      
      if (/\btry\s*\{[\s\S]*catch/.test(code)) {
        questions.push({
          type: 'debugging',
          question: 'What happens in a try-catch block when an error occurs in the try section?',
          options: [
            'The program stops completely',
            'The error is ignored',
            'Control moves to the catch block',
            'The try block restarts'
          ],
          correct: 2,
          explanation: 'When an error occurs in the try block, control immediately moves to the catch block, allowing you to handle the error gracefully.'
        });
      }
      
      return questions;
    }

    generateOptimizationQuestions(code, language) {
      const questions = [];
      
      if (/for\s*\([^)]*\)\s*\{[\s\S]*for\s*\([^)]*\)/.test(code)) {
        questions.push({
          type: 'optimization',
          question: 'What is the time complexity of nested loops?',
          options: ['O(n)', 'O(log n)', 'O(n²)', 'O(2n)'],
          correct: 2,
          explanation: 'Nested loops typically result in O(n²) time complexity, as the inner loop runs n times for each of the n iterations of the outer loop.'
        });
      }
      
      if (/for\s*\([^)]*\.length[^)]*\)/.test(code)) {
        questions.push({
          type: 'optimization',
          question: 'How can you optimize a loop that checks array.length in the condition?',
          options: [
            'Use a while loop instead',
            'Cache the length in a variable',
            'Use recursion',
            'Reverse the loop'
          ],
          correct: 1,
          explanation: 'Caching the array length in a variable prevents the length property from being accessed on every iteration, improving performance.'
        });
      }
      
      return questions;
    }

    shuffleArray(array) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
  }

  const quizGenerator = new QuizGenerator();

  function analyzeLineByLine(text, lang) {
    const lines = text.split(/\r?\n/);
    const analysis = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;
      const result = { lineNumber: lineNum, code: line, insights: [] };
      
      if (!trimmed) {
        result.insights.push({ type: 'whitespace', text: 'Empty line for readability' });
      } else {
        // Comments
        if (/^\s*(\/\/|#|<!--|\/\*|\*)/.test(line)) {
          result.insights.push({ type: 'comment', text: 'Documentation or explanation' });
        }
        
        // Function/method definitions
        if (/\b(function|def|func|fn|method)\s+\w+/.test(trimmed)) {
          result.insights.push({ type: 'definition', text: 'Function/method definition' });
        }
        
        // Variable declarations
        if (/\b(var|let|const|int|string|float|double|bool)\s+\w+/.test(trimmed)) {
          result.insights.push({ type: 'variable', text: 'Variable declaration' });
        }
        
        // Control structures
        if (/\b(if|else|elif|elsif|for|while|switch|case|try|catch|finally)\b/.test(trimmed)) {
          result.insights.push({ type: 'control', text: 'Control flow structure' });
        }
        
        // Imports/includes
        if (/\b(import|include|require|using|from)\b/.test(trimmed)) {
          result.insights.push({ type: 'import', text: 'External dependency' });
        }
        
        // Class definitions
        if (/\bclass\s+\w+/.test(trimmed)) {
          result.insights.push({ type: 'class', text: 'Class definition' });
        }
        
        // Return statements
        if (/\breturn\b/.test(trimmed)) {
          result.insights.push({ type: 'return', text: 'Function return value' });
        }
        
        // API calls or external interactions
        if (/\.(get|post|put|delete|fetch|ajax)\(|fetch\(|axios\.|requests\.|http/.test(trimmed)) {
          result.insights.push({ type: 'api', text: 'External API interaction' });
        }
        
        // Error handling
        if (/\b(throw|raise|error|exception|panic)\b/i.test(trimmed)) {
          result.insights.push({ type: 'error', text: 'Error handling or exception' });
        }
        
        // Console/logging
        if (/\b(console\.|print|log|debug|warn|error|println|cout|System\.out)/.test(trimmed)) {
          result.insights.push({ type: 'logging', text: 'Debug output or logging' });
        }
        
        // Async operations
        if (/\b(async|await|Promise|then|catch|defer|go\s+func)\b/.test(trimmed)) {
          result.insights.push({ type: 'async', text: 'Asynchronous operation' });
        }
        
        // Database operations
        if (/\b(SELECT|INSERT|UPDATE|DELETE|query|execute|prepare)\b/i.test(trimmed)) {
          result.insights.push({ type: 'database', text: 'Database operation' });
        }
        
        // Security concerns
        if (/\b(eval|exec|system|shell_exec|innerHTML|dangerouslySetInnerHTML)\b/.test(trimmed)) {
          result.insights.push({ type: 'security', text: '⚠️ Potential security risk' });
        }
        
        // Performance considerations
        if (/\b(for.*in|forEach|map|filter|reduce|\+\+|--|\.length)/.test(trimmed)) {
          if (trimmed.includes('.length') && /for.*<.*\.length/.test(trimmed)) {
            result.insights.push({ type: 'performance', text: '💡 Consider caching .length in loop' });
          } else {
            result.insights.push({ type: 'iteration', text: 'Data iteration or manipulation' });
          }
        }
        
        // Null/undefined checks
        if (/\b(null|undefined|None|nil|nullptr)\b|==\s*null|!=\s*null/.test(trimmed)) {
          result.insights.push({ type: 'nullcheck', text: 'Null/undefined handling' });
        }
        
        // Memory management
        if (/\b(malloc|free|new|delete|gc\.|dispose)\b/.test(trimmed)) {
          result.insights.push({ type: 'memory', text: 'Memory allocation/deallocation' });
        }
        
        // Complex expressions
        if ((trimmed.match(/[()]/g) || []).length > 4) {
          result.insights.push({ type: 'complexity', text: '💡 Complex expression - consider simplifying' });
        }
        
        // Long lines
        if (line.length > 100) {
          result.insights.push({ type: 'style', text: '💡 Long line - consider breaking up' });
        }
        
        // No insights found
        if (result.insights.length === 0) {
          result.insights.push({ type: 'general', text: 'Code execution or operation' });
        }
      }
      
      analysis.push(result);
    }
    
    return analysis;
  }

  async function analyzeCode(text) {
    const lang = guessLanguage(text);

    let aiAnalysis;
    try {
      // Get AI-powered analysis (Grok 4 via OpenRouter only)
      aiAnalysis = await aiService.analyzeCode(text, lang);
    } catch (e) {
      // If AI call fails, provide a full fallback object so UI renders safely
      aiAnalysis = {
        overview: 'AI analysis unavailable.',
        codeQuality: { score: 75, grade: 'Good', factors: { readability: 'Medium', maintainability: 'Medium', complexity: 'Medium' } },
        suggestions: [],
        learningPoints: [],
        securityAnalysis: { issues: [], score: 'Unknown' },
        performanceInsights: [],
        bestPractices: [],
        patterns: { patterns: [], description: '' },
        lineAnalysisAI: null,
        quizAI: null
      };
    }

    // Summary focuses on what the code actually does
    const summary = aiAnalysis.overview || summarize(text, lang);

    // Tests: keep local suggestions plus top AI suggestions
    const tests = [
      ...sampleTests(text, lang),
      ...((aiAnalysis.suggestions || []).slice(0, 2).map(s => `AI Suggestion: ${s}`))
    ];

    // Questions: keep local thought questions plus AI learning points
    const reviewQuestions = [
      ...questions(text, lang),
      ...((aiAnalysis.learningPoints || []).slice(0, 2))
    ];

    const lines = text.split(/\r?\n/);

    // Line analysis: prefer AI; fallback to local if missing/empty; final guard
    let lineAnalysis;
    if (Array.isArray(aiAnalysis.lineAnalysisAI) && aiAnalysis.lineAnalysisAI.length) {
      lineAnalysis = aiAnalysis.lineAnalysisAI.map(item => ({
        lineNumber: item.lineNumber,
        code: lines[item.lineNumber - 1] ?? '',
        insights: (item.insights || []).map(msg => ({ type: 'ai-enhanced', text: msg }))
      }));
    } else {
      lineAnalysis = analyzeLineByLine(text, lang);
    }
    if (!Array.isArray(lineAnalysis) || lineAnalysis.length === 0) {
      lineAnalysis = analyzeLineByLine(text, lang);
    }

    // Quiz: prefer AI; fallback to generator + AI-derived extras (no enforced length)
    let quiz;
    if (Array.isArray(aiAnalysis.quizAI) && aiAnalysis.quizAI.length) {
      quiz = aiAnalysis.quizAI;
    } else {
      quiz = [
        ...quizGenerator.generateQuiz(text, lang),
        ...generateAIQuizQuestions(text, lang, aiAnalysis)
      ];
    }

    // Ensure every quiz question has a sequential numeric id for click handlers
    quiz = (quiz || []).map((q, idx) => ({ ...q, id: idx + 1 }));

    // Final guard: if still empty, generate some default quiz questions
    if (!quiz.length) {
      quiz = quizGenerator.generateQuiz(text, lang).map((q, idx) => ({ ...q, id: idx + 1 }));
    }

    return {
      language: lang,
      summary,
      tests,
      questions: reviewQuestions,
      lineAnalysis,
      quiz,
      aiAnalysis
    };
  }

  function generateAILineInsights(line, language, aiAnalysis) {
    const insights = [];
    
    // Add AI-powered insights based on the analysis
    if (aiAnalysis.securityAnalysis.issues.length > 0) {
      aiAnalysis.securityAnalysis.issues.forEach(issue => {
        if (line.includes('eval') || line.includes('innerHTML') || line.includes('document.write')) {
          insights.push({ type: 'security', text: issue });
        }
      });
    }
    
    if (aiAnalysis.performanceInsights.length > 0) {
      aiAnalysis.performanceInsights.forEach(insight => {
        if (line.includes('for') || line.includes('map') || line.includes('filter')) {
          insights.push({ type: 'performance', text: insight });
        }
      });
    }
    
    if (aiAnalysis.suggestions.length > 0) {
      aiAnalysis.suggestions.forEach(suggestion => {
        if (line.includes('var ') || line.includes('==') || line.includes('console.log')) {
          insights.push({ type: 'ai-suggestion', text: suggestion });
        }
      });
    }
    
    return insights;
  }

  function generateAIQuizQuestions(text, language, aiAnalysis) {
    const questions = [];
    
    // Generate questions based on AI analysis
    const patterns = aiAnalysis?.patterns?.patterns || [];
    if (patterns.length > 0) {
      questions.push({
        type: 'concept',
        question: `What programming patterns are used in this ${language} code?`,
        options: [
          'Only basic patterns',
          patterns.join(', '),
          'Object-oriented only',
          'Functional only'
        ],
        correct: 1,
        explanation: `This code uses ${patterns.join(', ')} patterns.`
      });
    }
    
    const score = aiAnalysis?.codeQuality?.score ?? 100;
    if (score < 80) {
      questions.push({
        type: 'optimization',
        question: 'What could improve the code quality score?',
        options: [
          'Add more comments',
          'Reduce complexity',
          'Add error handling',
          'All of the above'
        ],
        correct: 3,
        explanation: `The code quality score is ${score}/100. Consider: ${(aiAnalysis?.suggestions || []).slice(0, 2).join(', ')}`
      });
    }
    
    return questions.slice(0, 2); // Limit to 2 additional questions
  }


  function createStyles() {
    return `
      :host { all: initial; }
      .cca-card { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; position: fixed; top: 16px; right: 16px; width: 480px; max-width: calc(100vw - 32px); background: #0b1021; color: #e6e8ee; border: 1px solid #2a2f45; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 2147483647; }
      .cca-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #22263a; }
      .cca-title { font-size: 14px; font-weight: 600; }
      .cca-lang { margin-left: 8px; font-size: 11px; color: #b8c0d4; background: #141a38; border: 1px solid #2a2f45; padding: 2px 6px; border-radius: 999px; text-transform: lowercase; }
      .cca-actions { display: flex; gap: 8px; }
      .cca-btn { background: #1d2340; color: #e6e8ee; border: 1px solid #2a2f45; padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; }
      .cca-btn:hover { background: #232a52; }
      .cca-close { background: transparent; border: none; color: #9aa3b2; font-size: 16px; cursor: pointer; padding: 2px 6px; }
      .cca-tabs { display: flex; border-bottom: 1px solid #22263a; }
      .cca-tab { flex: 1; padding: 8px 12px; font-size: 12px; background: transparent; border: none; color: #9aa3b2; cursor: pointer; border-bottom: 2px solid transparent; }
      .cca-tab.active { color: #e6e8ee; border-bottom-color: #3053f5; }
      .cca-tab:hover { background: #1a1e3a; }
      .cca-tab-content { display: none; }
      .cca-tab-content.active { display: block; }
      .cca-body { padding: 10px 12px; max-height: 60vh; overflow: auto; }
      .cca-section { margin-bottom: 8px; }
      .cca-section h4 { margin: 0 0 4px 0; font-size: 12px; color: #b8c0d4; }
      .cca-code { background: #0f1530; border: 1px solid #2a2f45; padding: 6px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; }
      .cca-list { margin: 0; padding-left: 18px; }
      .cca-line-item { display: flex; margin-bottom: 8px; padding: 6px 8px; background: #0f1530; border: 1px solid #2a2f45; border-radius: 6px; }
      .cca-line-num { min-width: 32px; color: #666; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; text-align: right; padding-right: 8px; }
      .cca-line-content { flex: 1; }
      .cca-line-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #e6e8ee; margin-bottom: 4px; white-space: pre-wrap; }
      .cca-insights { display: flex; flex-wrap: wrap; gap: 4px; }
      .cca-insight { background: #1d2340; color: #b8c0d4; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
      .cca-insight.comment { background: #2d4a2d; color: #90ee90; }
      .cca-insight.definition { background: #4a2d4a; color: #dda0dd; }
      .cca-insight.variable { background: #2d3d4a; color: #87ceeb; }
      .cca-insight.control { background: #4a3d2d; color: #f0e68c; }
      .cca-insight.security { background: #4a2d2d; color: #ff6b6b; }
      .cca-insight.performance { background: #2d4a4a; color: #20b2aa; }
      .cca-insight.ai-enhanced { background: #4a2d4a; color: #dda0dd; border: 1px solid #8a4d8a; }
      .cca-row { display: flex; align-items: center; gap: 8px; color: #9aa3b2; font-size: 12px; }
      .cca-toggle { width: 34px; height: 20px; background: #2a2f45; border-radius: 10px; position: relative; cursor: pointer; border: 1px solid #3a4160; }
      .cca-dot { width: 16px; height: 16px; background: #e6e8ee; border-radius: 50%; position: absolute; top: 1px; left: 1px; transition: transform 0.15s ease; }
      .cca-toggle.on { background: #3053f5; }
      .cca-toggle.on .cca-dot { transform: translateX(14px); }
      .cca-line-analysis { max-height: 400px; overflow: auto; }
      .cca-ai-section { margin-bottom: 12px; }
      .cca-ai-overview { background: #141a38; padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #3053f5; }
      .cca-quality-score { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .cca-score-badge { background: #2d4a2d; color: #90ee90; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      .cca-score-badge.fair { background: #4a4a2d; color: #f0e68c; }
      .cca-score-badge.poor { background: #4a2d2d; color: #ff6b6b; }
      .cca-suggestions-list { margin: 0; padding-left: 16px; }
      .cca-suggestions-list li { margin-bottom: 4px; }
      .cca-api-key-section { background: #1a1e3a; padding: 10px; border-radius: 6px; margin-bottom: 10px; }
      .cca-input { background: #0f1530; border: 1px solid #2a2f45; color: #e6e8ee; padding: 6px 8px; border-radius: 4px; width: 100%; font-size: 12px; }
      .cca-input::placeholder { color: #666; }
      .cca-save-btn { background: #3053f5; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 6px; }
      .cca-save-btn:hover { background: #4a6bff; }
      .cca-quiz-question { background: #141a38; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
      .cca-quiz-options { margin: 8px 0; }
      .cca-quiz-option { display: block; background: #1d2340; color: #e6e8ee; border: 1px solid #2a2f45; padding: 8px 12px; margin: 4px 0; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
      .cca-quiz-option:hover { background: #232a52; }
      .cca-quiz-option.selected { background: #3053f5; }
      .cca-quiz-option.correct { background: #2d4a2d; border-color: #90ee90; }
      .cca-quiz-option.incorrect { background: #4a2d2d; border-color: #ff6b6b; }
      .cca-quiz-explanation { background: #0f1530; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 11px; border-left: 3px solid #3053f5; }
      .cca-quiz-score { text-align: center; padding: 16px; background: #141a38; border-radius: 6px; }
      .cca-score-circle { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-size: 18px; font-weight: bold; }
      .cca-loading { text-align: center; padding: 20px; color: #9aa3b2; }
      .cca-loading::after { content: ''; display: inline-block; width: 12px; height: 12px; border: 2px solid #3053f5; border-radius: 50%; border-top-color: transparent; animation: spin 1s linear infinite; margin-left: 8px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      
      /* Enhanced Summary UI Styles */
      .cca-summary-content { 
        background: #141a38; 
        padding: 10px; 
        border-radius: 8px; 
        border-left: 3px solid #3053f5; 
        font-size: 12px; 
        line-height: 1.45;
        margin-bottom: 6px;
      }
      .cca-summary-list { 
        margin: 0; 
        padding-left: 16px; 
      }
      .cca-summary-list li { 
        margin: 2px 0; 
      }
      .cca-tests-container, .cca-questions-container { 
        display: flex; 
        flex-direction: column; 
        gap: 6px; 
      }
      .cca-test-item, .cca-question-item { 
        display: flex; 
        align-items: flex-start; 
        gap: 10px; 
        background: #0f1530; 
        padding: 8px; 
        border-radius: 6px; 
        border: 1px solid #2a2f45;
        transition: background 0.2s ease;
      }
      .cca-test-item:hover, .cca-question-item:hover { 
        background: #141a38; 
      }
      .cca-test-number, .cca-question-number { 
        min-width: 22px; 
        height: 22px; 
        background: #3053f5; 
        color: white; 
        border-radius: 50%; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        font-size: 10px; 
        font-weight: 600; 
        flex-shrink: 0;
      }
      .cca-test-content, .cca-question-content { 
        flex: 1; 
        font-size: 12px; 
        line-height: 1.4; 
        color: #e6e8ee;
      }
      .cca-section h4 { 
        margin: 0 0 10px 0; 
        font-size: 13px; 
        color: #b8c0d4; 
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      /* AI-Enhanced Summary Styles */
      .cca-quality-display {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #141a38;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #2a2f45;
      }
      .cca-score-circle-small {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: bold;
        color: white;
      }
      .cca-score-circle-small.excellent { background: #2d4a2d; }
      .cca-score-circle-small.good { background: #4a4a2d; }
      .cca-score-circle-small.fair { background: #4a2d2d; }
      .cca-quality-grade {
        font-size: 12px;
        color: #e6e8ee;
        font-weight: 600;
      }
      
      .cca-security-display {
        background: #141a38;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #2a2f45;
      }
      .cca-security-score {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .cca-security-score.good { background: #2d4a2d; color: #90ee90; }
      .cca-security-score.fair { background: #4a4a2d; color: #f0e68c; }
      .cca-security-score.needs attention { background: #4a2d2d; color: #ff6b6b; }
      .cca-security-issues {
        margin-top: 8px;
      }
      .cca-security-issue {
        background: #0f1530;
        padding: 6px 8px;
        border-radius: 4px;
        margin: 4px 0;
        font-size: 11px;
        color: #ff6b6b;
      }
      .cca-security-clean {
        color: #90ee90;
        font-size: 11px;
        font-weight: 600;
      }
      
      .cca-performance-display {
        background: #141a38;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #2a2f45;
      }
      .cca-performance-item {
        background: #0f1530;
        padding: 6px 8px;
        border-radius: 4px;
        margin: 4px 0;
        font-size: 11px;
        color: #20b2aa;
      }
      
      .cca-insight.ai-suggestion {
        background: #4a2d4a;
        color: #dda0dd;
        border: 1px solid #8a4d8a;
      }
      
      /* Learning and Practices Styles */
      .cca-learning-container, .cca-practices-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .cca-learning-item, .cca-practice-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: #0f1530;
        padding: 8px;
        border-radius: 6px;
        border: 1px solid #2a2f45;
        transition: background 0.2s ease;
      }
      .cca-learning-item:hover, .cca-practice-item:hover {
        background: #141a38;
      }
      .cca-learning-number, .cca-practice-number {
        min-width: 24px;
        height: 24px;
        background: #3053f5;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .cca-learning-content, .cca-practice-content {
        flex: 1;
        font-size: 12px;
        line-height: 1.4;
        color: #e6e8ee;
      }
    `;
  }

  function renderLineAnalysis(lineAnalysis) {
    return lineAnalysis.map(line => {
      const insightElements = line.insights.map(insight => 
        `<span class="cca-insight ${insight.type}">${escapeHtml(insight.text)}</span>`
      ).join('');
      
      return `
        <div class="cca-line-item">
          <div class="cca-line-num">${line.lineNumber}</div>
          <div class="cca-line-content">
            <div class="cca-line-code">${escapeHtml(line.code)}</div>
            <div class="cca-insights">${insightElements}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderQuiz(quiz) {
    if (!quiz || quiz.length === 0) {
      return '<div style="text-align: center; padding: 20px; color: #9aa3b2;">No quiz questions available for this code.</div>';
    }

    const questionsHtml = quiz.map(question => `
      <div class="cca-quiz-question" data-question-id="${question.id}">
        <div style="font-weight: 600; margin-bottom: 8px;">Question ${question.id}: ${escapeHtml(question.question)}</div>
        <div class="cca-quiz-options">
          ${question.options.map((option, index) => `
            <button class="cca-quiz-option" data-option="${index}">
              ${String.fromCharCode(65 + index)}. ${escapeHtml(option)}
            </button>
          `).join('')}
        </div>
        <div class="cca-quiz-explanation" style="display: none;">
          <strong>Explanation:</strong> ${escapeHtml(question.explanation)}
        </div>
      </div>
    `).join('');

    return `
      <div class="cca-quiz-container">
        <div style="text-align: center; margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600;">Code Knowledge Quiz</div>
          <div style="font-size: 11px; color: #9aa3b2;">Test your understanding of this code</div>
        </div>
        ${questionsHtml}
        <div class="cca-quiz-score" style="display: none;">
          <div class="cca-score-circle">
            <span class="cca-score-text">0/0</span>
          </div>
          <div>Quiz Complete!</div>
        </div>
      </div>
    `;
  }

  function renderPanel(analysis, code) {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = createStyles();

    const card = document.createElement('div');
    card.className = 'cca-card';
    
    // No AI content needed - AI is integrated into other tabs
    
    card.innerHTML = `
      <div class="cca-head">
        <div class=\"cca-title\">ClipCode Analyst <span class=\"cca-lang\">${escapeHtml(analysis.language)}</span></div>
        <div class=\"cca-actions\">
          <button class="cca-btn cca-copy">Copy analysis</button>
          <button class="cca-close" title="Close">×</button>
        </div>
      </div>
      <div class="cca-tabs">
        <button class="cca-tab active" data-tab="summary">Summary</button>
        <button class="cca-tab" data-tab="line-analysis">Line Analysis</button>
        <button class="cca-tab" data-tab="quiz">Quiz</button>
      </div>
      <div class="cca-body">
        <div class="cca-tab-content active" data-content="summary">
          <div class="cca-section">
            <h4>📋 AI-Powered Code Summary</h4>
            <div class="cca-summary-content">${summaryToBullets(analysis.summary)}</div>
          </div>

          ${!AI_CONFIG.apiKey ? `
          <div class="cca-section">
            <h4>🔑 API Key</h4>
            <div class="cca-api-key-section">
              <input class="cca-input cca-api-key-input" type="password" placeholder="Paste your OpenRouter API key (sk-or-...)" />
              <button class="cca-save-btn cca-api-key-save">Save</button>
              <div class="cca-api-key-hint" style="margin-top:6px; font-size: 11px; color: #9aa3b2;">Key is stored locally via chrome.storage and never leaves your browser.</div>
            </div>
          </div>
          ` : ''}
          
          ${analysis.aiAnalysis ? `
          <div class="cca-section">
            <h4>🔒 Security</h4>
            <div class="cca-security-display">
              <div class="cca-security-score ${analysis.aiAnalysis.securityAnalysis.score.toLowerCase()}">${analysis.aiAnalysis.securityAnalysis.score}</div>
              ${analysis.aiAnalysis.securityAnalysis.issues.length > 0 ? `
                <div class="cca-security-issues">
                  ${analysis.aiAnalysis.securityAnalysis.issues.map(issue => `<div class="cca-security-issue">${escapeHtml(issue)}</div>`).join('')}
                </div>
              ` : '<div class="cca-security-clean">✅ No security issues detected</div>'}
            </div>
          </div>
          ` : ''}
          
          <div class="cca-section">
            <h4>🧪 Suggested Tests</h4>
            <div class="cca-tests-container">
              ${analysis.tests.slice(0,3).map((test, index) => `
                <div class="cca-test-item">
                  <div class="cca-test-number">${index + 1}</div>
                  <div class="cca-test-content">${escapeHtml(test)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="cca-section">
            <h4>🎓 Learning Points</h4>
            <div class="cca-learning-container">
              ${(analysis.aiAnalysis?.learningPoints || []).slice(0,3).map((point, index) => `
                <div class="cca-learning-item">
                  <div class="cca-learning-number">${index + 1}</div>
                  <div class="cca-learning-content">${escapeHtml(point)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="cca-section">
            <h4>💡 Best Practices</h4>
            <div class="cca-practices-container">
              ${(analysis.aiAnalysis?.bestPractices || []).slice(0,3).map((practice, index) => `
                <div class="cca-practice-item">
                  <div class="cca-practice-number">${index + 1}</div>
                  <div class="cca-practice-content">${escapeHtml(practice)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="cca-section">
            <h4>💻 Code Snippet</h4>
            <pre class="cca-code">${escapeHtml(truncate(code, 1600))}</pre>
          </div>
        </div>
        <div class="cca-tab-content" data-content="line-analysis">
          <div class="cca-section">
            <h4>🔍 Line-by-Line Analysis (AI Enhanced)</h4>
            <div class="cca-line-analysis">
              ${renderLineAnalysis(analysis.lineAnalysis)}
            </div>
          </div>
        </div>
        <div class="cca-tab-content" data-content="quiz">
          ${renderQuiz(analysis.quiz)}
        </div>
        <div class="cca-row">
          <div class="cca-toggle ${STATE.enabled ? 'on' : ''}"><div class="cca-dot"></div></div>
          <div>Show prompts after copying code</div>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    // Tab functionality
    const tabs = card.querySelectorAll('.cca-tab');
    const contents = card.querySelectorAll('.cca-tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        
        // Update tab states
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update content states
        contents.forEach(content => {
          content.classList.remove('active');
          if (content.dataset.content === targetTab) {
            content.classList.add('active');
          }
        });
      });
    });

    const closeBtn = card.querySelector('.cca-close');
    closeBtn?.addEventListener('click', () => host.remove());

    const copyBtn = card.querySelector('.cca-copy');
    copyBtn?.addEventListener('click', async () => {
      const text = formatForClipboard(analysis, code);
      try { await navigator.clipboard.writeText(text); } catch (_) {}
    });

    const toggle = card.querySelector('.cca-toggle');
    toggle?.addEventListener('click', () => {
      STATE.enabled = !STATE.enabled;
      toggle.classList.toggle('on', STATE.enabled);
      try { chrome.storage?.local.set({ [STORAGE_KEY]: STATE.enabled }); } catch (_) {}
    });

    // AI is now integrated directly into the analysis - no configuration needed

    // Quiz functionality
    setupQuizHandlers(card, analysis.quiz);

    // API key save handler (if present)
    const keyInput = card.querySelector('.cca-api-key-input');
    const keySave = card.querySelector('.cca-api-key-save');
    if (keyInput && keySave) {
      keySave.addEventListener('click', () => {
        const k = keyInput.value.trim();
        if (!k) return;
        AI_CONFIG.apiKey = k;
        try { chrome.storage?.local.set({ [API_KEY_STORAGE_KEY]: k }); } catch (_) {}
        keyInput.value = '';
        keySave.textContent = 'Saved';
        setTimeout(() => { keySave.textContent = 'Save'; }, 1200);
      });
    }

    return host;
  }

  function setupQuizHandlers(card, quiz) {
    if (!quiz || quiz.length === 0) return;
    
    let answers = {};
    let questionsAnswered = 0;
    
    // Add click handlers to quiz options
    const questions = card.querySelectorAll('.cca-quiz-question');
    questions.forEach(questionEl => {
      const questionId = parseInt(questionEl.dataset.questionId);
      const question = quiz.find(q => q.id === questionId);
      if (!question) return;
      
      const options = questionEl.querySelectorAll('.cca-quiz-option');
      options.forEach(option => {
        option.addEventListener('click', () => {
          // Remove previous selection
          options.forEach(opt => {
            opt.classList.remove('selected', 'correct', 'incorrect');
          });
          
          const selectedIndex = parseInt(option.dataset.option);
          const isCorrect = selectedIndex === question.correct;
          
          // Mark the selected option
          option.classList.add('selected');
          
          // Show correct answer
          options[question.correct].classList.add('correct');
          if (!isCorrect) {
            option.classList.add('incorrect');
          }
          
          // Disable all options for this question
          options.forEach(opt => opt.style.pointerEvents = 'none');
          
          // Show explanation
          const explanation = questionEl.querySelector('.cca-quiz-explanation');
          explanation.style.display = 'block';
          
          // Track answer
          if (!answers[questionId]) {
            answers[questionId] = isCorrect;
            questionsAnswered++;
            
            // Check if quiz is complete
            if (questionsAnswered === quiz.length) {
              setTimeout(() => showQuizResults(card, answers, quiz), 1000);
            }
          }
        });
      });
    });
  }
  
  function showQuizResults(card, answers, quiz) {
    const correctCount = Object.values(answers).filter(Boolean).length;
    const totalCount = quiz.length;
    const percentage = Math.round((correctCount / totalCount) * 100);
    
    const scoreElement = card.querySelector('.cca-quiz-score');
    const scoreText = scoreElement.querySelector('.cca-score-text');
    const scoreCircle = scoreElement.querySelector('.cca-score-circle');
    
    scoreText.textContent = `${correctCount}/${totalCount}`;
    
    // Color code the score
    if (percentage >= 80) {
      scoreCircle.style.backgroundColor = '#2d4a2d';
      scoreCircle.style.color = '#90ee90';
    } else if (percentage >= 60) {
      scoreCircle.style.backgroundColor = '#4a4a2d';
      scoreCircle.style.color = '#f0e68c';
    } else {
      scoreCircle.style.backgroundColor = '#4a2d2d';
      scoreCircle.style.color = '#ff6b6b';
    }
    
    scoreElement.style.display = 'block';
    scoreElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function formatForClipboard(analysis, code) {
    const tests = analysis.tests.map(t => `- ${t}`).join('\n');
    const qs = analysis.questions.map(q => `- ${q}`).join('\n');
    return [
      `Summary: ${analysis.summary}`,
      '',
      'Suggested tests:',
      tests,
      '',
      'Questions to consider:',
      qs,
      '',
      'Code snippet:',
      truncate(code, 4000)
    ].join('\n');
  }

  function truncate(s, max) {
    if (!s) return s;
    return s.length > max ? s.slice(0, max) + '\n…(truncated)…' : s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Create condensed bullets from an overview paragraph
  function summaryToBullets(text) {
    if (!text) return '<ul class="cca-summary-list"><li>No summary available.</li></ul>';
    const parts = String(text)
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!parts.length) return '<ul class="cca-summary-list"><li>' + escapeHtml(text) + '</li></ul>';
    return '<ul class="cca-summary-list">' + parts.map(p => '<li>' + escapeHtml(p) + '</li>').join('') + '</ul>';
  }

  async function showPanel(code) {
    try {
      const analysis = await analyzeCode(code);
      renderPanel(analysis, code);
    } catch (error) {
      console.error('Analysis failed:', error);
      // Do not use local/mock analysis; show an AI-only error panel
      const lang = guessLanguage(code);
      const failed = {
        language: lang,
        summary: `AI analysis failed: ${error?.message || 'Unknown error'}`,
        tests: [],
        questions: [],
        lineAnalysis: [],
        quiz: [],
        aiAnalysis: null
      };
      renderPanel(failed, code);
    }
  }

  document.addEventListener('copy', () => {
    if (!STATE.enabled) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    const clean = (text || '').trim();
    if (!isProbablyCode(clean)) return;
    const now = Date.now();
    if (now - STATE.lastShownAt < 2500) return; // throttle
    STATE.lastShownAt = now;
    setTimeout(() => showPanel(clean), 10);
  }, true);
})();
