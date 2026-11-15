import { LoginPanel } from "@/components/LoginPanel";

/** 企業の方のログイン（自社だけを見られる） */
export default function CompanyLoginPage() {
  return <LoginPanel portal="company" />;
}
