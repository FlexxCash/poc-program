use anchor_lang::prelude::*;

declare_id!("CxG6PB8YC9aAjZ7NA3CjyuCY7nUBysiuBdwUtMkJL4H1");

#[program]
pub mod access_control {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        access_control.admin = ctx.accounts.admin.key();
        access_control.is_paused = false;
        access_control.permissions = Vec::new();
        
        // 添加日誌輸出
        msg!("AccessControl PDA initialized: {:?}", ctx.accounts.access_control.key());
        msg!("Admin: {:?}", ctx.accounts.admin.key());
        
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
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 1 + 4 + (32 + 1) * 10 + 64, // 增加 64 字節的額外空間
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
