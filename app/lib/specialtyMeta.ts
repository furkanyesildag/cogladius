/**
 * Client-safe specialty metadata — no server imports.
 * orchestrator.ts re-exports this for server-side use.
 */
import type { AgentSpecialty } from "./types";

export const SPECIALTY_META: Record<AgentSpecialty, {
  label: string;
  color: string;
  icon: string;
  keywords: string[];
  defaultCriteria: string[];
}> = {
  frontend:   { label: "Frontend",         color: "#7C9EFF", icon: "web",              keywords: ["react","next","vue","css","html","ui","frontend","interface","component","tailwind"], defaultCriteria: ["Responsive tasarım","Kod kalitesi","Kullanıcı deneyimi"] },
  backend:    { label: "Backend",          color: "#40E183", icon: "dns",              keywords: ["api","server","database","backend","node","postgres","redis","rest","graphql","sql"],  defaultCriteria: ["Güvenlik","Performans","Belgeleme"] },
  blockchain: { label: "Blockchain",       color: "#FF5625", icon: "currency_bitcoin", keywords: ["stellar","ethereum","smart contract","nft","defi","token","wallet","soroban","web3","blockchain"], defaultCriteria: ["Güvenlik denetimi","On-chain doğrulama","Gas optimizasyonu"] },
  design:     { label: "Grafik Tasarım",   color: "#FF8C42", icon: "palette",          keywords: ["design","ui","ux","figma","logo","brand","visual","graphic","illustration","mockup"],  defaultCriteria: ["Görsel tutarlılık","Kullanılabilirlik","Yaratıcılık"] },
  ai_ml:      { label: "AI / ML",          color: "#B97DFF", icon: "smart_toy",        keywords: ["machine learning","ai","model","llm","fine-tune","training","neural","gpt","claude","embedding"], defaultCriteria: ["Model doğruluğu","Performans","Açıklanabilirlik"] },
  data:       { label: "Veri Analizi",     color: "#FFD166", icon: "analytics",        keywords: ["data","analytics","sql","dashboard","chart","visualization","pandas","etl","pipeline","metrics"], defaultCriteria: ["Veri doğruluğu","İçgörüler","Görselleştirme"] },
  devops:     { label: "DevOps",           color: "#4FC3F7", icon: "settings_suggest", keywords: ["devops","ci","cd","docker","kubernetes","deploy","infrastructure","cloud","aws","vercel"],  defaultCriteria: ["Güvenilirlik","Ölçeklenebilirlik","Otomasyon"] },
  finance:    { label: "Finans",           color: "#FFD166", icon: "account_balance",  keywords: ["finance","financial","tokenomics","budget","cost","revenue","model","excel","pricing","economics"], defaultCriteria: ["Doğruluk","Kaynak doğrulama","Pratik öngörüler"] },
  content:    { label: "İçerik",           color: "#7CE7AC", icon: "edit_note",        keywords: ["content","writing","copywriting","seo","blog","social","marketing","copy","article","newsletter"], defaultCriteria: ["Okunabilirlik","SEO uyumu","Yaratıcılık"] },
  research:   { label: "Araştırma",        color: "#A8B0C0", icon: "lab_research",     keywords: ["research","analysis","report","market","competitor","study","survey","literature","findings"],   defaultCriteria: ["Kaynak doğrulama","Derinlik","Pratik öngörüler"] },
  mobile:     { label: "Mobil",            color: "#F48FB1", icon: "smartphone",       keywords: ["mobile","ios","android","react native","flutter","swift","kotlin","app store","push notification"], defaultCriteria: ["Platform uyumu","UX","Performans"] },
  security:   { label: "Güvenlik",         color: "#EF9A9A", icon: "security",         keywords: ["security","audit","pentest","vulnerability","exploit","firewall","encryption","authentication"],   defaultCriteria: ["Risk tespiti","Kapsamlılık","Öneri kalitesi"] },
};
