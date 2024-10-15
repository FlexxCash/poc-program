use anchor_lang::prelude::*;

declare_id!("4kjF7HMVZN4S5x3kh9EZ4mUK5WbmpdrZMncv1zzakikd");

#[program]
pub mod access_control {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
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
        msg!("Bump: {}", bump);
        
        Ok(())
    }

    pub fn emergency_stop(ctx: Context<EmergencyStop>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        require!(ctx.accounts.admin.key() == access_control.admin, AccessControlError::Unauthorized);

        require!(!access_control.is_paused, AccessControlError::AlreadyPaused);

        access_control.is_paused = true;
        msg!("Emergency stop activated by admin: {:?}", ctx.accounts.admin.key());
        Ok(())
    }

    pub fn resume(ctx: Context<EmergencyStop>) -> Result<()> {
        let access_control = &mut ctx.accounts.access_control;
        require!(ctx.accounts.admin.key() == access_control.admin, AccessControlError::Unauthorized);

        require!(access_control.is_paused, AccessControlError::NotPaused);

        access_control.is_paused = false;
        msg!("System resumed by admin: {:?}", ctx.accounts.admin.key());
        Ok(())
    }

    pub fn close_account(ctx: Context<CloseAccount>) -> Result<()> {
        require!(ctx.accounts.admin.key() == ctx.accounts.access_control.admin, AccessControlError::Unauthorized);
        
        msg!("AccessControl account closed by admin: {:?}", ctx.accounts.admin.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 1 + 4 + (32 + 1) * 20 + 128,
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
