/**
 * questions.js
 * ------------------------------------------------------------------
 * "이륙 전 체크리스트" 질문 모델 (v2 — 모순 없는 재설계).
 *
 * 설계 원칙:
 *  1) 초보자는 '언어/프레임워크'를 모른다 → 절대 묻지 않는다.
 *     대신 "어떻게 쓸 거냐(의도)"만 일상 언어로 묻고,
 *     언어·구조는 promptBuilder가 자동으로 결정한다.
 *  2) 모순 방지 → 서로 얽히는 축(다중 접속·데이터 격리·로그인·영속성)을
 *     '하나의 선택'으로 묶는다. 종속되는 사실은 묻지 않고 유도(derive)한다.
 *       - "각자 로그인해서 내 데이터를 본다"를 고르면
 *         → 다중 사용자 + 데이터 격리 + 로그인 + DB 저장이 '한 번에' 확정된다.
 *         → "저장 필요 없음" 같은 모순 선택 자체가 불가능해진다.
 *  3) 돈이 드는 구성(서버·DB)은 선택 시점에 '유료일 수 있음'을 명시한다.
 *
 * 이 파일은 순수 데이터 + 분기(라우팅)만 담는다.
 * 다음 질문 계산은 next(문자열) 또는 next(answers)=>id(함수)로 표현한다.
 * ------------------------------------------------------------------
 */

export const STEP_LABELS = {
  core: '무엇을',
  reach: '누가 · 어떻게',
  data: '데이터 & 파일',
  connect: '외부 연결',
  deliver: 'AI 도구',
};

/** 파일 처리 이후 공통 라우팅: 로컬이면 저장 여부를 묻고, 배포면 바로 외부연결로 */
const afterFiles = (a) => (a.deploy === 'local' ? 'localSave' : 'secrets');

export const QUESTIONS = [
  // ── 1. 무엇을 만들까 ────────────────────────────────────────────
  {
    id: 'idea',
    step: 'core',
    type: 'text',
    title: '어떤 마법 같은 프로그램을 만들고 싶으신가요?',
    hint: '떠오르는 대로 편하게 적어주세요. 이 내용이 그대로 "기능 명세서"가 됩니다.',
    placeholder: '예) 엑셀 파일을 올리면 AI가 요약해서 표로 그려주는 웹사이트',
    required: true,
    next: 'deploy',
  },

  // ── 2. 어떻게 쓸 것인가 (진짜 분기점) ───────────────────────────
  {
    id: 'deploy',
    step: 'reach',
    type: 'single',
    title: '이걸 어떻게 쓸 계획인가요?',
    hint: '여기서 "내 컴퓨터용 도구"로 남을지, "인터넷 서비스"가 될지 갈려요.',
    options: [
      {
        value: 'local',
        label: '나 혼자, 내 컴퓨터에서만 쓸 거예요',
        desc: '연습용이거나 나만의 도구예요. 아직 인터넷에 올릴 생각은 없어요.',
        next: 'files',
      },
      {
        value: 'deploy',
        label: '인터넷에 올려서 다른 사람도 쓰게 할 거예요',
        desc: '링크를 공유해 친구·고객·팀원이 접속해요.',
        next: 'audience',
      },
    ],
    recommend: 'deploy',
    recommendReason:
      '나중에 링크로 공유할 가능성이 조금이라도 있다면 처음부터 "인터넷에 올린다"를 고르세요. 혼자용으로 짠 코드를 나중에 여럿용으로 바꾸는 건 사실상 재작성입니다.',
  },

  // ── 3. (배포 시) 누가 어떻게 쓰나 — 모순 축을 하나로 묶음 ────────
  {
    id: 'audience',
    step: 'reach',
    type: 'single',
    title: '인터넷에 올렸을 때, 사람들이 어떻게 쓰나요?',
    hint: '이 하나로 "로그인·데이터 저장·사용자 구분"이 한 번에 정해져요. 가장 가까운 걸 고르세요.',
    options: [
      {
        value: 'tool',
        label: '로그인 없이 누구나 바로 쓰는 "도구"예요',
        desc: '예) 파일 변환기, 요약기, 계산기. 각자 쓰고 끝나요. 계정·개인 저장이 없어요.',
        tag: '가장 간단',
        next: 'files',
      },
      {
        value: 'private',
        label: '각자 로그인해서 "내 정보"를 저장하고 다시 봐요',
        desc: '예) 메모장, 가계부, 나만의 기록. 로그인·개인 데이터가 필요해요.',
        tag: '서버 비용 주의',
        next: 'files',
      },
      {
        value: 'shared',
        label: '모두가 "같은 화면"을 함께 보고 바꿔요',
        desc: '예) 팀 게시판, 실시간 순위표, 공용 대시보드. 모두의 데이터가 함께 쌓여요.',
        tag: '서버 비용 주의',
        next: 'files',
      },
    ],
    recommend: 'tool',
    recommendReason:
      '첫 서비스라면 로그인 없는 "도구"가 가장 쉽고 대부분 무료로 배포됩니다. 로그인·개인 데이터나 공유 화면이 필요하면 서버(DB)가 계속 필요해 요금이 들 수 있습니다.',
  },

  // ── 4. 파일 업로드 ─────────────────────────────────────────────
  {
    id: 'files',
    step: 'data',
    type: 'single',
    title: '이미지·PDF·엑셀 같은 "파일"을 올리는 기능이 있나요?',
    options: [
      {
        value: 'no',
        label: '아니요, 파일 업로드는 없어요',
        desc: '글자·버튼 입력만으로 동작해요.',
        next: afterFiles,
      },
      {
        value: 'yes',
        label: '네, 사용자가 파일을 올려요',
        desc: '업로드한 파일이 섞이거나 서버 용량이 터지지 않게 해야 해요.',
        next: 'fileHandling',
      },
    ],
    recommend: 'no',
    recommendReason:
      '지금 파일 업로드가 확실히 없으면 "아니요"를 고르세요. 나중에 필요해지면 그때 추가해도 늦지 않습니다.',
  },
  {
    id: 'fileHandling',
    step: 'data',
    type: 'single',
    title: '올라온 파일은 어떻게 할까요?',
    options: [
      {
        value: 'ephemeral',
        label: '분석·변환만 하고 바로 지울 거예요',
        desc: '결과만 필요하고 원본은 남길 필요 없어요. (일회성)',
        tag: '가장 간단',
        next: afterFiles,
      },
      {
        value: 'permanent',
        label: '나중에도 볼 수 있게 계속 보관할 거예요',
        desc: '갤러리·내 문서함처럼 다시 열어봐야 해요.',
        tag: '저장공간 비용 주의',
        next: afterFiles,
      },
    ],
    recommend: 'ephemeral',
    recommendReason:
      '처리 후 결과만 보여주면 끝이면 일회성이 안전하고 비용도 안 듭니다. "다시 본다"가 핵심 기능일 때만 영구 보관을 고르세요 — 저장공간 비용이 들 수 있어요.',
  },

  // ── 5. (로컬 전용) 기록 저장 여부 ──────────────────────────────
  {
    id: 'localSave',
    step: 'data',
    type: 'single',
    title: '만든 기록이 다음에 다시 켰을 때도 남아있어야 하나요?',
    hint: '내 컴퓨터에서만 쓰니까, 저장해도 따로 서버 비용은 들지 않아요.',
    options: [
      {
        value: 'memory',
        label: '아니요, 그때그때 쓰고 꺼지면 사라져도 돼요',
        desc: '한 번 쓰고 마는 계산기·변환기 같은 도구예요.',
        next: 'secrets',
      },
      {
        value: 'save',
        label: '네, 저장해두고 다음에 또 보고 싶어요',
        desc: '내 컴퓨터에 파일(또는 작은 DB)로 저장돼요. 무료예요.',
        next: 'secrets',
      },
    ],
    recommend: 'memory',
    recommendReason:
      '결과 한 번 보여주고 끝이면 저장 없이 가세요. 히스토리·누적 기록이 핵심일 때만 저장을 고르면 됩니다.',
  },

  // ── 6. 외부 연결 & 비밀 키 ─────────────────────────────────────
  {
    id: 'secrets',
    step: 'connect',
    type: 'single',
    title: 'AI나 외부 서비스를 연결하나요?',
    hint: 'OpenAI 같은 AI, 결제, 지도, 문자 발송, 공공데이터처럼 "비밀 키가 필요한" 연결 말이에요.',
    options: [
      {
        value: 'no',
        label: '아니요, 그런 외부 연결은 없어요',
        desc: '내 코드 안에서만 동작해요.',
        next: 'aitool',
      },
      {
        value: 'yes',
        label: '네, AI나 외부 서비스를 연결해요',
        desc: '비밀 키가 필요해요. GitHub에 실수로 올려 요금 폭탄 맞는 사고를 막아야 해요.',
        tag: '요금 폭탄 주의',
        next: 'aitool',
      },
    ],
    recommend: 'yes',
    recommendReason:
      'AI·결제·지도 등 외부 서비스를 조금이라도 쓴다면 "네"입니다. 비밀 키가 코드에 박히면 공개 저장소에 올리는 순간 털립니다. 애매하면 "네"로 두는 게 안전합니다.',
  },

  // ── 7. 어떤 AI 도구에 넣을 것인가 (출력 프로토콜 분기) ──────────
  {
    id: 'aitool',
    step: 'deliver',
    type: 'single',
    title: '완성된 프롬프트를 어떤 AI로 코딩하실 건가요?',
    hint: '도구 방식에 따라 코드를 받는 법이 달라서, 거기에 딱 맞게 프롬프트를 맞춰드려요.',
    options: [
      {
        value: 'chatbot',
        label: '채팅형 AI — ChatGPT · Claude · Gemini',
        desc: '대화창에 붙여넣고 답을 받아 직접 복사해 쓰는 방식이에요. 큰 프로젝트는 나눠서 받아야 잘려요.',
        next: null,
      },
      {
        value: 'agent',
        label: '코딩 에이전트 — Cursor · Claude Code · Codex · Cline',
        desc: '내 프로젝트 폴더의 파일을 직접 만들고 고쳐주는 도구예요. 큰 프로젝트도 한 번에 잘 다뤄요.',
        tag: '큰 프로젝트 유리',
        next: null,
      },
    ],
    recommend: 'chatbot',
    recommendReason:
      '평소 ChatGPT·Claude·Gemini 대화창에 붙여넣어 쓰신다면 채팅형(대부분 초보가 해당)입니다. Cursor·Claude Code 같은 편집기 도구를 쓰고 있다면 에이전트형이 더 수월합니다 — 큰 프로젝트도 중간에 안 잘리고 실행·검증까지 해주거든요.',
  },
];

/** id로 질문 찾기 */
export function getQuestion(id) {
  return QUESTIONS.find((q) => q.id === id) || null;
}

/**
 * 현재 질문 + 선택값 + 지금까지의 답변으로 다음 질문 id를 계산한다.
 * next 는 문자열이거나 (answers)=>id 함수일 수 있다. (모순 없는 분기의 핵심)
 */
export function resolveNext(question, selectedValue, answers) {
  let n = question.next;
  if (question.type === 'single') {
    const opt = question.options.find((o) => o.value === selectedValue);
    if (opt && opt.next !== undefined) n = opt.next;
  }
  if (typeof n === 'function') return n(answers || {});
  return n || null;
}

/** 시작 질문 id */
export const START_ID = 'idea';
