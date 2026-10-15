import ejs from 'ejs';
import nodemailer, { Transporter } from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config/env.js';

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
  private transporter: Transporter;
  private config = loadConfig();

  constructor() {
    this.transporter = this.createTransporter();
  } 


  private createTransporter(): Transporter {
    return nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_PORT === 465,
      auth: {
        user: this.config.SMTP_USER,
        pass: this.config.SMTP_PASS,
      },
    });
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

      // Add common data to all templates
      const templateData: T & BaseTemplateData = {
        ...data,
        currentYear: new Date().getFullYear(),
        companyName: this.config.COMPANY_NAME,
        privacyPolicyLink: this.config.PRIVACY_POLICY_URL,
        termsLink: this.config.TERMS_URL,
        supportLink: this.config.SUPPORT_URL,
        companyAddress: this.config.COMPANY_ADDRESS,
        unsubscribeLink: `${this.config.APP_URL}/unsubscribe`,
      };

      return await ejs.renderFile(templatePath, templateData);
    } catch (error) {
      console.error(`Error rendering template ${templateName}:`, error);
      throw new Error(`Failed to render email template: ${templateName}`);
    }
  }

  private async sendEmail(options: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail(options);
      console.log(`Email sent successfully to ${options.to}`);
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send email');
    }
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
      from: `"${this.config.COMPANY_NAME}" <${this.config.FROM_EMAIL}>`,
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
      from: `"${this.config.COMPANY_NAME}" <${this.config.FROM_EMAIL}>`,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: 'Password Reset Successful',
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
      from: `"${this.config.COMPANY_NAME}" <${this.config.FROM_EMAIL}>`,
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
      from: `"${this.config.COMPANY_NAME}" <${this.config.FROM_EMAIL}>`,
      to: this.config.NODE_ENV === "development" ? this.config.DEV_EMAIL : userEmail,
      subject: report.ok ? 'Your database backup is ready' : 'Your database backup failed',
      html,
    });
  }

  // Utility method to verify transporter connection
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log('Email service connection verified successfully');
      return true;
    } catch (error) {
      console.error('Email service connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Also export the class for testing or custom instances
export default EmailService;