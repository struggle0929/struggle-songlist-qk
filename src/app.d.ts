declare global {
  namespace App {
    interface Locals {
      userId: string | null;
      isAdmin: boolean;
    }

    interface PageData {
      isAdmin: boolean;
    }
  }
}

export {};
