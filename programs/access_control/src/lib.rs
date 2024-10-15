use anchor_lang::prelude::*;

declare_id!("2JWqmJFU9Sf2rQy8NZG2ST4Tty7QwR4j8K3KnTJm6JAU");

#[program]
pub mod access_control {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        access_control.admin = ctx.accounts.admin.key();
        access_control.is_paused = false;
        access_control.permissions = Vec::new();
        
        let pda_key = access_control.key();
        let admin_key = ctx.accounts.admin.key();
        let is_paused = access_control.is_paused;
        let permissions_len = access_control.permissions.len();
        
        msg!("AccessControl PDA initialized: {:?}", pda_key);
        msg!("Admin: {:?}", admin_key);
        msg!("Is paused: {}", is_paused);
        msg!("Permissions length: {}", permissions_len);
        
        Ok(())
    }

    pub fn emergency_stop(ctx: Context<EmergencyStop>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        require!(ctx.accounts.admin.key() == access_control.admin, AccessControlError::Unauthorized);

        require!(!access_control.is_paused, AccessControlError::AlreadyPaused);

        access_control.is_paused = true;
        Ok(())
    }

    pub fn resume(ctx: Context<EmergencyStop>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        require!(ctx.accounts.admin.key() == access_control.admin, AccessControlError::Unauthorized);

        require!(access_control.is_paused, AccessControlError::NotPaused);

        access_control.is_paused = false;
        Ok(())
    }

    pub fn close_account(ctx: Context<CloseAccount>) -> Result<()> {
        // 檢查調用者是否為管理員
        require!(ctx.accounts.admin.key() == ctx.accounts.access_control.admin, AccessControlError::Unauthorized);
        
        // 帳戶將自動關閉，因為我們在 CloseAccount 結構中使用了 close 約束
        msg!("AccessControl account closed successfully");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 1 + 4 + (32 + 1) * 20 + 128, // 增加空間
        seeds = [b"access_control", admin.key().as_ref()],
        bump
    )]
    pub access_control: Account<'info, AccessControl>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPermissions<'info> {
    #[account(
        mut,
        seeds = [b"access_control", admin.key().as_ref()],
        bump
    )]
    pub access_control: Account<'info, AccessControl>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyStop<'info> {
    #[account(
        mut,
        seeds = [b"access_control", admin.key().as_ref()],
        bump
    )]
    pub access_control: Account<'info, AccessControl>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseAccount<'info> {
    #[account(
        mut,
        close = admin,
        seeds = [b"access_control", admin.key().as_ref()],
        bump
    )]
    pub access_control: Account<'info, AccessControl>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[account]
pub struct AccessControl {
    pub admin: Pubkey,
    pub is_paused: bool,
    pub permissions: Vec<(String, bool)>,
}

#[error_code]
pub enum AccessControlError {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid permission value")]
    InvalidPermission,
    #[msg("System is already paused")]
    AlreadyPaused,
    #[msg("System is not paused")]
    NotPaused,
}
