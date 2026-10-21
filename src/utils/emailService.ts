import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config/env.js';
import { loadMailConfig } from '../config/mail_config.js';
import { companyBrand, type CompanyBrand } from '../shared/emails/company-brand.js';
import { sendMail } from './mailer.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define interfaces for template data
interface BaseTemplateData {
  currentYear: number;
  companyName: string;
  privacyPolicyLink: string;
  termsLink: string;
  supportLink: string;
  companyAddress: string;
  unsubscribeLink: string;
  /** Read by the brand header and company footer every template includes. */
  company: CompanyBrand;
}

interface PasswordResetData {
  userName: string;
  resetLink: string;
  expiryHours: string;
  ipAddress: string;
  requestDate: string;
}

interface PasswordResetSuccessData {
  userName: string;
  loginLink: string;
  resetDate: string;
  location: string;
  browserInfo: string;
}

interface WelcomeEmailData {
  userName: string;
  userEmail: string;
  dashboardLink: string;
  accountType: string;
  registrationDate: string;
  socialLinks: {
    twitter: string;
    facebook: string;
    linkedin: string;
  };
}

interface AccountDetails {
  type: string;
}

interface NewAccountData {
  userName: string;
  loginEmail: string;
  password: string;
  pin: string | null;
  accountType: string;
  loginLink: string;
}

interface PasswordResetMetadata {
  location?: string;
  browser?: string;
}

interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
}

// Environment variables interface

class EmailService {
  private config = loadConfig();
  private mail = loadMailConfig(this.config);

  /**
   * The sender every message goes out under, unchanged in shape from before:
   * the company name in front of the address. Resend will only send from a
   * domain verified in its account, so a configured RESEND_FROM wins over
   * FROM_EMAIL.
   */
  private get from(): string {
    return `"${this.config.COMPANY_NAME}" <${this.mail.from}>`;
  }

  /** The saved company name for a subject line; the configured one until it is saved. */
  private async companyName(): Promise<string> {
    return (await companyBrand())?.name || this.config.COMPANY_NAME;
  }

  private async renderTemplate<T extends Record<string, any>>(
    templateName: string,
    data: T
  ): Promise<string> {
    try {
      const templatePath = path.join(
        __dirname,
        '..',
        'shared',
        'emails',
        'templates',
        `${templateName}.ejs`
      );

      // The saved company profile, with the environment as the fallback until
      // it has been filled in. Its logo and details are shown in every email.
      const saved = await companyBrand();
      const company: CompanyBrand = {
        name: saved?.name || this.config.COMPANY_NAME,
        logoUrl: saved?.logoUrl ?? null,
        address: saved?.address ?? this.config.COMPANY_ADDRESS,
        phone: saved?.phone ?? null,
        email: saved?.email ?? null,
        website: saved?.website ?? null,
        taxId: saved?.taxId ?? null,
      };

      // Add common data to all templates
      const templateData: T & BaseTemplateData = {
        ...data,
        company,
        currentYear: new Date().getFullYear(),
        companyName: company.name,
        privacyPolicyLink: this.config.PRIVACY_POLICY_URL,
        termsLink: this.config.TERMS_URL,
        supportLink: this.config.SUPPORT_URL,
        companyAddress: company.address ?? this.config.COMPANY_ADDRESS,
        unsubscribeLink: `${this.config.APP_URL}/unsubscribe`,
      };

      return await ejs.renderFile(templatePath, templateData);
    } catch (error) {
      console.error(`Error rendering template ${templateName}:`, error);
      throw new Error(`Failed to render email template: ${templateName}`);
    }
  }

  private async sendEmail(options: EmailOptions): Promise<void> {
    // The mailer logs why it failed; the caller only needs to know that it did.
    const sent = await sendMail(options, this.mail);
    if (!sent) throw new Error('Failed to send email');
    console.log(`Email sent successfully to ${options.to}`);
  }

  async sendPasswordResetEmail(
    userEmail: string,
    userName: string,
    resetToken: string,
    metadata?: { ipAddress?: string }
  ): Promise<void> {
    const resetLink = `${this.config.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const html = await this.renderTemplate<PasswordResetData>('password-reset', {
      userName,
      resetLink,
      expiryHours: '1',
      ipAddress: metadata?.ipAddress || 'Unknown',
      requestDate: new Date().toLocaleString(),
    });

    await this.sendEmail({
      from: this.from,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: 'Reset Your Password',
      html,
    });
  }

  async sendPasswordResetSuccessEmail(
    userEmail: string,
    userName: string,
    metadata: PasswordResetMetadata = {}
  ): Promise<void> {
    const html = await this.renderTemplate<PasswordResetSuccessData>(
      'password-reset-success',
      {
        userName,
        loginLink: `${this.config.FRONTEND_URL}/login`,
        resetDate: new Date().toLocaleString(),
        location: metadata.location || 'Unknown',
        browserInfo: metadata.browser || 'Unknown',
      }
    );

    await this.sendEmail({
      from: this.from,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: 'Password Reset Successful',
      html,
    });
  }

  /**
   * Hands a newly created user the account they can sign in with: the address
   * it was created under and the password set for it, and the PIN too when one
   * was generated for them. Sent once, when the account is created.
   */
  async sendNewAccountEmail(
    userEmail: string,
    userName: string,
    credentials: { password: string; pin?: string | null; accountType?: string }
  ): Promise<void> {
    const html = await this.renderTemplate<NewAccountData>('new-account', {
      userName,
      loginEmail: userEmail,
      password: credentials.password,
      pin: credentials.pin ?? null,
      accountType: credentials.accountType ?? 'Account',
      loginLink: `${this.config.FRONTEND_URL}/login`,
    });

    await this.sendEmail({
      from: this.from,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: `Your ${await this.companyName()} account`,
      html,
    });
  }

  async sendWelcomeEmail(
    userEmail: string,
    userName: string,
    accountDetails: AccountDetails = { type: 'Free' }
  ): Promise<void> {
    const html = await this.renderTemplate<WelcomeEmailData>(
      'welcome-new-customer',
      {
        userName,
        userEmail,
        dashboardLink: `${this.config.FRONTEND_URL}/dashboard`,
        accountType: accountDetails.type || 'Free',
        registrationDate: new Date().toLocaleDateString(),
        socialLinks: {
          twitter: this.config.TWITTER_URL,
          facebook: this.config.FACEBOOK_URL,
          linkedin: this.config.LINKEDIN_URL,
        },
      }
    );

    await this.sendEmail({
      from: this.from,
      to: userEmail,
      subject: `Welcome to ${this.config.COMPANY_NAME}! 🎉`,
      html,
    });
  }

  /** Tells whoever asked for a backup that it is ready, or why it failed. */
  async sendBackupReportEmail(
    userEmail: string,
    userName: string,
    report:
      | { id: string; ok: true; fileName: string; sizeBytes: number; expiresAt: Date }
      | { id: string; ok: false; error: string }
  ): Promise<void> {
    const html = await this.renderTemplate('backup-report', {
      userName,
      ok: report.ok,
      fileName: report.ok ? report.fileName : '',
      size: report.ok ? `${(report.sizeBytes / 1024 / 1024).toFixed(2)} MB` : '',
      expiresAt: report.ok ? report.expiresAt.toLocaleString() : '',
      error: report.ok ? '' : report.error,
      backupsLink: `${this.config.FRONTEND_URL}/backups`,
    });

    await this.sendEmail({
      from: this.from,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: report.ok ? 'Your database backup is ready' : 'Your database backup failed',
      html,
    });
  }

  /**
   * Resend is called per message, so there is no connection to open. This says
   * whether mail can go out at all: a key is configured, or it is being logged.
   */
  async verifyConnection(): Promise<boolean> {
    if (this.mail.transport === 'log') {
      console.log('Email service is writing messages to the log, not sending them');
      return true;
    }
    if (this.mail.apiKey === '') {
      console.error('Email service is not configured: RESEND_API_KEY is missing');
      return false;
    }
    console.log('Email service connection verified successfully');
    return true;
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Also export the class for testing or custom instances
export default EmailService;