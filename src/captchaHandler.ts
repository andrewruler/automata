import { Page } from 'playwright';
import { llm } from './llm.js';

export interface CaptchaSolution {
  type: 'click' | 'type' | 'select';
  coordinates?: { x: number; y: number };
  text?: string;
  selector?: string;
  description: string;
}

export class CaptchaHandler {
  private maxAttempts = 3;
  
  async handleCaptcha(page: Page, screenshotBuffer: Buffer): Promise<boolean> {
    let attempts = 0;
    
    while (attempts < this.maxAttempts) {
      try {
        // Get captcha solution from GPT
        const solution = await this.getCaptchaSolution(screenshotBuffer);
        
        // Execute the solution
        const success = await this.executeSolution(page, solution);
        
        if (success) {
          // Click continue button
          await this.clickContinue(page);
          return true;
        }
        
        attempts++;
      } catch (error) {
        console.error(`Captcha attempt ${attempts + 1} failed:`, error);
        attempts++;
      }
    }
    
    // If all attempts fail, wait for manual assistance
    await this.waitForManualAssistance(page);
    return false;
  }
  
  private async getCaptchaSolution(screenshotBuffer: Buffer): Promise<CaptchaSolution> {
    const prompt = `
      Analyze this captcha image and provide a solution in JSON format:
      
      {
        "type": "click" | "type" | "select",
        "coordinates": { "x": number, "y": number } | null,
        "text": string | null,
        "selector": string | null,
        "description": "Brief description of what to do"
      }
      
      For image captchas: use "click" with coordinates
      For text captchas: use "type" with the text
      For selection captchas: use "select" with selector
    `;
    
    const response = await llm.getResponse([
      { role: 'system', content: 'You are a captcha solver. Respond only with valid JSON.' },
      { role: 'user', content: prompt }
    ], screenshotBuffer);
    
    return JSON.parse(response);
  }
  
  private async executeSolution(page: Page, solution: CaptchaSolution): Promise<boolean> {
    try {
      switch (solution.type) {
        case 'click':
          if (solution.coordinates) {
            await page.mouse.click(solution.coordinates.x, solution.coordinates.y);
          }
          break;
          
        case 'type':
          if (solution.text) {
            await page.keyboard.type(solution.text);
          }
          break;
          
        case 'select':
          if (solution.selector) {
            await page.click(solution.selector);
          }
          break;
      }
      
      // Wait a moment for the action to register
      await page.waitForTimeout(1000);
      return true;
    } catch (error) {
      console.error('Failed to execute captcha solution:', error);
      return false;
    }
  }
  
  private async clickContinue(page: Page): Promise<void> {
    // Common continue button selectors
    const continueSelectors = [
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
      'input[type="submit"]',
      '.continue-btn',
      '#continue'
    ];
    
    for (const selector of continueSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          await page.waitForTimeout(1000);
          break;
        }
      } catch (error) {
        // Continue to next selector
      }
    }
  }
  
  private async waitForManualAssistance(page: Page): Promise<void> {
    console.log('Captcha solving failed after maximum attempts. Waiting for manual assistance...');
    
    // Keep the browser open for manual intervention
    await page.waitForTimeout(60000); // Wait 1 minute
    
    // Check if captcha is still present
    const captchaStillPresent = await this.detectCaptcha(page);
    if (captchaStillPresent) {
      console.log('Captcha still present after manual intervention timeout.');
    }
  }
  
  private async detectCaptcha(page: Page): Promise<boolean> {
    const captchaIndicators = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
      '.captcha',
      '[id*="captcha"]',
      'img[alt*="captcha" i]'
    ];
    
    for (const selector of captchaIndicators) {
      const element = await page.$(selector);
      if (element) return true;
    }
    
    return false;
  }
}