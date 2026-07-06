/**
 * guideBuilder.js — 위저드 답변 → "AI에게 이렇게 요청하세요" 가이드.
 * ------------------------------------------------------------------
 * 중요: 여기서는 '완성 프롬프트'를 만들지 않는다(그건 nocalhostmore 사이트의
 * 몫이며, 광고 수익 퍼널의 목적지다). 펫은 "무엇을 요청해야 하는지"를 짚어주는
 * 가이드까지만 보여주고, [프롬프트 생성하기] 버튼이 답변을 담아 사이트로 보낸다.
 *
 * 각 항목은 답변을 그대로 되읊지 않고, 실제 아키텍처/개발 용어(term)로 번역한
 * 뒤 그 용어를 왜 요청해야 하는지(detail)를 짧게 설명한다.
 * ------------------------------------------------------------------
 */

// 질문 진행 순서(분기 포함). 답변에 있는 것만 골라 순서대로 가이드를 만든다.
const ORDER = [
  "idea",
  "deploy",
  "audience",
  "files",
  "fileHandling",
  "localSave",
  "secrets",
  "aitool",
];

// `${questionId}:${value}` → { term: 뱃지로 보여줄 기술 용어, title, detail }.
const GUIDE = {
  "deploy:local": {
    term: "Local-only",
    title: "배포 인프라 제외(No Deployment)",
    detail: "서버·호스팅 설정이 필요 없는 로컬 실행 전용 구조임을 명시하세요. 범위가 줄어 구현이 단순해집니다.",
  },
  "deploy:deploy": {
    term: "Static Hosting",
    title: "정적 배포 아키텍처 요청",
    detail: "Vercel·Netlify 같은 무료 정적 호스팅에 바로 올릴 수 있는 구조로 설계해 달라고 요청하세요.",
  },
  "audience:tool": {
    term: "Stateless",
    title: "인증 없는 Stateless 구조 요청",
    detail: "로그인·세션 관리가 없는 요청-응답형 구조라고 명시하세요. 서버 비용이 거의 들지 않습니다.",
  },
  "audience:private": {
    term: "Auth + Data Isolation",
    title: "사용자 인증 · 개인 데이터 격리 요청",
    detail: "로그인(Authentication)과 사용자별 데이터 분리(격리)가 필요합니다. 서버리스 DB(Supabase·Firebase 등) 사용을 요청하세요.",
  },
  "audience:shared": {
    term: "Real-time Sync",
    title: "실시간 동기화 구조 요청",
    detail: "여러 사용자가 같은 상태를 동시에 보고 바꾸는 실시간 동기화(웹소켓/실시간 DB) 구조를 요청하세요.",
  },
  "files:no": {
    term: "No File I/O",
    title: "파일 입출력 제외",
    detail: "파일 업로드·저장 로직이 없다고 명시해 구현 범위를 단순화하세요.",
  },
  "files:yes": {
    term: "Upload Validation",
    title: "파일 업로드 검증 정책 요청",
    detail: "업로드 용량 제한, 확장자 검증, 사용자별 파일 격리 정책을 함께 요청하세요.",
  },
  "fileHandling:ephemeral": {
    term: "Ephemeral Processing",
    title: "휘발성 처리 방식 요청",
    detail: "업로드 파일은 처리 직후 폐기하는 일회성(Ephemeral) 처리 방식을 요청하세요. 저장 비용이 들지 않습니다.",
  },
  "fileHandling:permanent": {
    term: "Persistent Storage",
    title: "영구 스토리지 연동 요청",
    detail: "파일을 계속 보관하는 영구 저장소(S3·Blob Storage 등) 연동을 요청하세요. 저장 용량 비용을 고려해야 합니다.",
  },
  "localSave:memory": {
    term: "In-memory State",
    title: "인메모리(비영속) 상태 요청",
    detail: "종료 시 데이터가 사라지는 인메모리 상태 관리로 충분하다고 명시하세요.",
  },
  "localSave:save": {
    term: "Local Persistence",
    title: "로컬 퍼시스턴스 요청",
    detail: "로컬 파일 또는 내장 DB(SQLite 등)에 데이터를 영속 저장하도록 요청하세요. 무료로 구현 가능합니다.",
  },
  "secrets:no": {
    term: "No External Deps",
    title: "외부 연동 없음 명시",
    detail: "서드파티 API 의존성이 없어 별도의 시크릿 관리가 필요 없다고 알려주세요.",
  },
  "secrets:yes": {
    term: "Env Vars / Secret Management",
    title: "환경변수 기반 시크릿 관리 필수 요청",
    detail: "API 키 등 민감정보는 코드에 하드코딩하지 말고 환경변수(.env)로 분리, .gitignore 처리까지 요청하세요. 빠뜨리면 과금 사고로 이어질 수 있습니다.",
  },
  "aitool:chatbot": {
    term: "Chunked Output",
    title: "청크 단위 출력 형식 요청",
    detail: "채팅형 AI는 응답 길이 제한이 있으니, 기능 단위로 나눠 순차적으로 받는 구조로 요청하세요.",
  },
  "aitool:agent": {
    term: "Execution Plan",
    title: "파일 단위 실행 계획 요청",
    detail: "코딩 에이전트에게는 프로젝트 구조와 파일별 작업 목록을 먼저 설계하도록 요청하면 결과물 품질이 올라갑니다.",
  },
};

/**
 * @param {Record<string,string>} answers
 * @returns {{ idea: string, items: {term:string, title:string, detail:string}[] }}
 */
export function buildGuide(answers) {
  const a = answers || {};
  const idea = (a.idea || "").trim();
  const items = [];
  for (const id of ORDER) {
    if (id === "idea") continue; // 아이디어는 별도(헤더)로 표시
    const v = a[id];
    if (v == null) continue;
    const g = GUIDE[`${id}:${v}`];
    if (g) items.push(g);
  }
  return { idea, items };
}
