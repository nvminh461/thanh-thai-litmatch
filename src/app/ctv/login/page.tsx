import { redirect } from "next/navigation";
import { getCtvSession } from "@/server/ctv-auth";
import styles from "../../admin/admin.module.css";

export const dynamic = "force-dynamic";

const errorMessages = {
  invalid: "Tài khoản hoặc mật khẩu không đúng, hoặc CTV đã bị khóa đăng nhập.",
  config: "Không đăng nhập được CTV. Vui lòng liên hệ admin.",
} as const;

export default async function CtvLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: keyof typeof errorMessages }>;
}) {
  const session = await getCtvSession();

  if (session) {
    redirect("/ctv");
  }

  const params = await searchParams;
  const errorMessage = params.error ? errorMessages[params.error] : "";

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel} aria-labelledby="ctv-login-title">
        <p className={styles.kicker}>CTV Thành Thái</p>
        <h1 id="ctv-login-title">Đăng nhập CTV</h1>
        <form className={styles.loginForm} action="/api/ctv/login" method="post">
          <label>
            <span>Tài khoản</span>
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            <span>Mật khẩu</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {errorMessage ? (
            <p className={styles.errorText} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button type="submit">Đăng nhập</button>
        </form>
      </section>
    </main>
  );
}
