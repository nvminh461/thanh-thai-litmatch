import { redirect } from "next/navigation";
import { getAdminSession } from "@/server/admin-auth";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

const errorMessages = {
  invalid: "Tài khoản hoặc mật khẩu không đúng.",
  config: "Thiếu cấu hình admin hoặc không kết nối được cơ sở dữ liệu.",
} as const;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: keyof typeof errorMessages }>;
}) {
  const session = await getAdminSession();

  if (session) {
    redirect("/admin");
  }

  const params = await searchParams;
  const errorMessage = params.error ? errorMessages[params.error] : "";

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel} aria-labelledby="admin-login-title">
        <p className={styles.kicker}>Quản trị Thành Thái</p>
        <h1 id="admin-login-title">Đăng nhập</h1>
        <form className={styles.loginForm} action="/api/admin/login" method="post">
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
