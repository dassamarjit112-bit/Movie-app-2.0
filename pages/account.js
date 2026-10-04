/* CineStream — Account Page Controller */

const AccountPage = (() => {
  let activeAvatarUrl = '';

  async function init() {
    // Render Shell Layout Nav
    document.getElementById('navbar-mount').innerHTML = UI.renderNavbar('account');
    document.getElementById('footer-mount').innerHTML = UI.renderFooter();
    document.getElementById('mobile-nav-mount').innerHTML = UI.renderMobileNav('account');
    UI.updateNavbarUser();
    UI.initRipples();

    const loginPrompt = document.getElementById('login-prompt');
    const dashboardContainer = document.getElementById('dashboard-container');
    const advancedLoginBtn = document.getElementById('advanced-login-btn');
    const goSignupBtn = document.getElementById('go-signup-btn');

    const session = await window.Auth.getSession();
    if (!session) {
      // Show beautiful login prompt instead of redirecting
      if (loginPrompt) loginPrompt.style.display = 'block';
      if (dashboardContainer) dashboardContainer.style.display = 'none';

      // Bind login button
      if (advancedLoginBtn) {
        advancedLoginBtn.onclick = () => {
          Router.navigate('login');
        };
        // Add hover effects via JS for advanced interactions
        advancedLoginBtn.addEventListener('mouseenter', () => {
          advancedLoginBtn.style.transform = 'translateY(-3px) scale(1.02)';
          advancedLoginBtn.style.boxShadow = '0 12px 32px rgba(229, 9, 20, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15) inset, 0 1px 0 rgba(255, 255, 255, 0.25) inset';
          const icon = advancedLoginBtn.querySelector('.material-symbols-outlined');
          if (icon) icon.style.transform = 'scale(1.1)';
          const arrow = advancedLoginBtn.querySelectorAll('.material-symbols-outlined')[1];
          if (arrow) arrow.style.transform = 'translateX(4px)';
        });
        advancedLoginBtn.addEventListener('mouseleave', () => {
          advancedLoginBtn.style.transform = 'translateY(0) scale(1)';
          advancedLoginBtn.style.boxShadow = '0 8px 24px rgba(229, 9, 20, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1) inset, 0 1px 0 rgba(255, 255, 255, 0.2) inset';
          const icon = advancedLoginBtn.querySelector('.material-symbols-outlined');
          if (icon) icon.style.transform = 'scale(1)';
          const arrow = advancedLoginBtn.querySelectorAll('.material-symbols-outlined')[1];
          if (arrow) arrow.style.transform = 'translateX(0)';
        });
        advancedLoginBtn.addEventListener('mousedown', () => {
          advancedLoginBtn.style.transform = 'translateY(-1px) scale(0.98)';
        });
        advancedLoginBtn.addEventListener('mouseup', () => {
          advancedLoginBtn.style.transform = 'translateY(-3px) scale(1.02)';
        });
      }

      // Bind signup button
      if (goSignupBtn) {
        goSignupBtn.onclick = () => {
          Router.navigate('login');
        };
        goSignupBtn.addEventListener('mouseenter', () => {
          goSignupBtn.style.background = 'rgba(255,255,255,0.08)';
          goSignupBtn.style.borderColor = 'rgba(255,255,255,0.3)';
          goSignupBtn.style.transform = 'translateY(-2px)';
        });
        goSignupBtn.addEventListener('mouseleave', () => {
          goSignupBtn.style.background = 'transparent';
          goSignupBtn.style.borderColor = 'rgba(255,255,255,0.15)';
          goSignupBtn.style.transform = 'translateY(0)';
        });
      }

      return;
    }

    const userId = session.user.id;

    // Show dashboard
    if (loginPrompt) loginPrompt.style.display = 'none';
    if (dashboardContainer) dashboardContainer.style.display = 'block';

    // Bind tab events
    setupTabs(userId);

    // Profile Settings tab init
    await setupProfileTab(session);

    // Check if user is Admin as per Supabase table / metadata
    try {
      const isAdmin = await window.Auth.isAdmin(userId);
      const adminBtn = document.getElementById('account-admin-btn');
      const adminCard = document.getElementById('admin-card');
      
      if (isAdmin) {
        if (adminBtn) adminBtn.style.display = 'flex';
        if (adminCard) adminCard.style.display = 'flex';
      } else {
        if (adminBtn) adminBtn.style.display = 'none';
        if (adminCard) adminCard.style.display = 'none';
      }
    } catch (adminErr) {
      console.warn('Admin check error in account page:', adminErr);
    }

    // Sign out buttons (sidebar + logout card)
    const signoutBtn = document.getElementById('account-signout-btn');
    const logoutCard = document.getElementById('logout-card');

    const triggerSignOut = async () => {
      try {
        UI.showModal({
          title: 'Sign Out',
          content: 'Are you sure you want to log out of CineStream? You will need to sign in again to access premium features.',
          confirmText: 'Sign Out',
          cancelText: 'Cancel',
          dangerous: true,
          onConfirm: async () => {
            try {
              await window.Auth.signOut();
              UI.toast('Logged out successfully.', 'info');
            } catch (err) {
              console.error('Sign out error:', err);
              UI.toast('Failed to sign out. Please try again.', 'error');
            }
          }
        });
      } catch (err) {
        console.error('Modal error:', err);
      }
    };

    // Bind sidebar sign-out button
    if (signoutBtn) {
      signoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerSignOut();
      });
      // Advanced sidebar button interactions
      signoutBtn.addEventListener('mouseenter', () => {
        signoutBtn.style.background = 'rgba(255,107,107,0.08)';
        signoutBtn.style.borderColor = 'rgba(255,107,107,0.35)';
        signoutBtn.style.transform = 'translateX(4px)';
        signoutBtn.style.boxShadow = '0 4px 12px rgba(255,107,107,0.1)';
        const icon = signoutBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.style.transform = 'rotate(-15deg) scale(1.1)';
      });
      signoutBtn.addEventListener('mouseleave', () => {
        signoutBtn.style.background = 'rgba(255,255,255,0.02)';
        signoutBtn.style.borderColor = 'rgba(255,107,107,0.15)';
        signoutBtn.style.transform = 'translateX(0)';
        signoutBtn.style.boxShadow = 'none';
        const icon = signoutBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.style.transform = 'rotate(0) scale(1)';
      });
    }

    // Bind logout card button
    if (logoutCard) {
      logoutCard.addEventListener('click', (e) => {
        e.preventDefault();
        triggerSignOut();
      });
      // Advanced logout card hover effects
      logoutCard.addEventListener('mouseenter', () => {
        logoutCard.style.transform = 'translateY(-2px)';
        logoutCard.style.borderColor = 'rgba(255,107,107,0.4)';
        logoutCard.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.12) 0%, rgba(255,107,107,0.04) 100%)';
        logoutCard.style.boxShadow = '0 8px 24px rgba(255,107,107,0.15)';
        // Activate glow
        const glowDiv = logoutCard.querySelector('div[style*="radial-gradient"]');
        if (glowDiv) glowDiv.style.opacity = '1';
        // Scale icon container
        const iconContainer = logoutCard.querySelector('div[style*="border-radius: 14px"]');
        if (iconContainer) {
          iconContainer.style.background = 'rgba(255,107,107,0.25)';
          iconContainer.style.transform = 'scale(1.05)';
        }
        // Slide arrow
        const allIcons = logoutCard.querySelectorAll('.material-symbols-outlined');
        if (allIcons.length > 1) {
          allIcons[1].style.transform = 'translateX(4px)';
        }
      });
      logoutCard.addEventListener('mouseleave', () => {
        logoutCard.style.transform = 'translateY(0)';
        logoutCard.style.borderColor = 'rgba(255,107,107,0.2)';
        logoutCard.style.background = 'linear-gradient(135deg, rgba(255,107,107,0.08) 0%, rgba(255,107,107,0.02) 100%)';
        logoutCard.style.boxShadow = 'none';
        // Deactivate glow
        const glowDiv = logoutCard.querySelector('div[style*="radial-gradient"]');
        if (glowDiv) glowDiv.style.opacity = '0';
        // Reset icon container
        const iconContainer = logoutCard.querySelector('div[style*="border-radius: 14px"]');
        if (iconContainer) {
          iconContainer.style.background = 'rgba(255,107,107,0.15)';
          iconContainer.style.transform = 'scale(1)';
        }
        // Reset arrow
        const allIcons = logoutCard.querySelectorAll('.material-symbols-outlined');
        if (allIcons.length > 1) {
          allIcons[1].style.transform = 'translateX(0)';
        }
      });
      logoutCard.addEventListener('mousedown', () => {
        logoutCard.style.transform = 'translateY(0) scale(0.98)';
      });
      logoutCard.addEventListener('mouseup', () => {
        logoutCard.style.transform = 'translateY(-2px) scale(1)';
      });
    }

    // Load initial tab datasets
    await loadSubscriptionDetails(userId);
    await loadWatchlist(userId);
    await loadWatchHistory(userId);
  }

  function setupTabs(userId) {
    const desktopNavButtons = document.querySelectorAll('.account-nav-btn');
    const mobileNavButtons = document.querySelectorAll('.mobile-tab-btn');
    const allNavButtons = [...desktopNavButtons, ...mobileNavButtons];
    const tabPanes = document.querySelectorAll('.tab-pane');

    function switchTab(targetTab) {
      // Toggle Nav State for both desktop and mobile
      allNavButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.tab === targetTab);
      });

      // Toggle Content Tab
      tabPanes.forEach(pane => {
        if (pane.id === `tab-${targetTab}`) {
          pane.style.display = 'block';
        } else {
          pane.style.display = 'none';
        }
      });
    }

    desktopNavButtons.forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

    mobileNavButtons.forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });
  }

  async function setupProfileTab(session) {
    const emailInput = document.getElementById('profile-email-input');
    const nameInput = document.getElementById('profile-name-input');
    const countryInput = document.getElementById('profile-country-input');
    const avatarImg = document.getElementById('profile-avatar-img');
    const changeBtn = document.getElementById('change-avatar-btn');
    const saveBtn = document.getElementById('save-profile-btn');
    const passwordInput = document.getElementById('profile-password-input');
    const updatePasswordBtn = document.getElementById('update-password-btn');

    if (!emailInput || !nameInput || !avatarImg) return;

    // Set standard email
    emailInput.value = session.user.email;

    // Fetch details
    const profile = await window.Auth.getProfile(session.user.id);
    const fullName = profile?.full_name || session.user.user_metadata?.full_name || 'CineStream User';
    activeAvatarUrl = profile?.avatar_url || session.user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=e50914&textColor=ffffff`;

    nameInput.value = fullName;
    if (countryInput) {
      countryInput.value = profile?.country || localStorage.getItem('cs_user_country') || 'india';
    }
    avatarImg.src = activeAvatarUrl;

    // Dynamic Seed avatar randomizer
    changeBtn.onclick = () => {
      const styles = ['initials', 'bottts', 'adventurer', 'fun-emoji'];
      const randomStyle = styles[Math.floor(Math.random() * styles.length)];
      const seed = Math.random().toString(36).substring(2, 9);
      activeAvatarUrl = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${seed}&backgroundColor=e50914,14d1ff`;
      avatarImg.src = activeAvatarUrl;
      UI.toast('Avatar seed randomized! Save changes to apply.', 'info');
    };

    // Save changes
    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const country = countryInput ? countryInput.value : 'india';
      
      if (!name) {
        UI.toast('Please enter a valid display name.', 'warning');
        return;
      }

      UI.setLoading(saveBtn, true);
      try {
        await window.Auth.updateProfile(session.user.id, {
          full_name: name,
          avatar_url: activeAvatarUrl,
          country: country
        });
        localStorage.setItem('cs_user_country', country);
        UI.toast('Profile settings updated successfully!', 'success');
        UI.updateNavbarUser();
        // Update subscription display to reflect country pricing
        await loadSubscriptionDetails(session.user.id);
      } catch (err) {
        UI.toast('Failed to save profile. Please try again.', 'error');
      } finally {
        UI.setLoading(saveBtn, false);
      }
    };

    // Update Password
    if (updatePasswordBtn && passwordInput) {
      updatePasswordBtn.onclick = async () => {
        const newPassword = passwordInput.value.trim();
        if (!newPassword || newPassword.length < 6) {
          UI.toast('Password must be at least 6 characters long.', 'warning');
          return;
        }

        UI.setLoading(updatePasswordBtn, true);
        try {
          await window.Auth.updatePassword(newPassword);
          UI.toast('Password updated successfully!', 'success');
          passwordInput.value = '';
        } catch (err) {
          UI.toast(err.message || 'Failed to update password. Please try again.', 'error');
        } finally {
          UI.setLoading(updatePasswordBtn, false);
        }
      };
    }
  }

  async function loadSubscriptionDetails(userId) {
    const activeDisplay = document.getElementById('sub-active-display');
    const inactiveDisplay = document.getElementById('sub-inactive-display');
    const planNameEl = document.getElementById('sub-plan-name');
    const periodEl = document.getElementById('sub-period');
    const priceEl = document.getElementById('sub-price');
    const cancelBtn = document.getElementById('cancel-sub-btn');

    if (!activeDisplay || !inactiveDisplay) return;

    const sub = await Subscriptions.getUserSubscription(userId);
    const plans = Subscriptions.getPlans();
    
    // Get user country from Supabase profile
    const profile = await window.Auth.getProfile(userId);
    const userCountry = profile?.country || localStorage.getItem('cs_user_country') || 'india';
    const pricing = Subscriptions.getCountryPricing(userCountry);

    if (sub && new Date(sub.end_date) > new Date()) {
      const plan = plans.find(p => p.id === sub.plan_id) || plans[1];
      
      planNameEl.textContent = `CineStream ${plan.name} (${plan.quality})`;
      priceEl.textContent = `${pricing.isIndia ? '₹' : '$'}${pricing.isIndia ? plan.price : plan.priceUSD}`;
      
      const renewText = sub.status === 'cancelled'
        ? `Cancelled — Access will expire on ${UI.formatDate(sub.end_date)}`
        : `Renews automatically on ${UI.formatDate(sub.end_date)}`;
      periodEl.textContent = renewText;

      activeDisplay.style.display = 'block';
      inactiveDisplay.style.display = 'none';

      // Setup Cancel Action
      if (sub.status === 'cancelled') {
        cancelBtn.style.display = 'none';
      } else {
        cancelBtn.style.display = 'inline-flex';
        cancelBtn.onclick = () => {
          UI.showModal({
            title: 'Cancel Membership',
            content: `Are you sure you want to cancel your active <strong>${plan.name}</strong> membership? You will retain standard streaming access until <strong>${UI.formatDate(sub.end_date)}</strong>.`,
            confirmText: 'Cancel Plan',
            cancelText: 'Keep Plan',
            dangerous: true,
            onConfirm: async () => {
              try {
                // Update status in Supabase subscription
                await window.sb
                  .from('subscriptions')
                  .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                  .eq('id', sub.id);

                UI.toast('Membership successfully cancelled.', 'success');
                // Reload dashboard
                await loadSubscriptionDetails(userId);
              } catch (err) {
                UI.toast('Failed to cancel membership.', 'error');
              }
            }
          });
        };
      }
    } else {
      activeDisplay.style.display = 'none';
      inactiveDisplay.style.display = 'block';
    }

    // Bind Quick Gift Code Box
    const giftInput = document.getElementById('quick-gift-input');
    const giftBtn = document.getElementById('quick-gift-btn');
    if (giftBtn && giftInput) {
      giftBtn.onclick = async () => {
        const code = giftInput.value.trim();
        if (!code) {
          UI.toast('Please enter a gift code.', 'warning');
          return;
        }

        UI.setLoading(giftBtn, true);
        try {
          await Subscriptions.redeemGiftCode(code, userId);
          UI.toast('Gift code successfully redeemed!', 'success');
          giftInput.value = '';
          
          // Reload subscription details
          await loadSubscriptionDetails(userId);
          UI.updateNavbarUser();
        } catch (err) {
          UI.toast(err.message || 'Failed to redeem gift code.', 'error');
        } finally {
          UI.setLoading(giftBtn, false);
        }
      };
    }
  }

  async function loadWatchlist(userId) {
    const grid = document.getElementById('account-watchlist-grid');
    const empty = document.getElementById('watchlist-empty');
    if (!grid) return;

    const list = await Subscriptions.getWatchlist(userId);

    if (list && list.length > 0) {
      grid.style.display = 'grid';
      if (empty) empty.style.display = 'none';

      const items = await Promise.all(list.map(async item => {
        let content = null;
        if (window.TMDB) {
          content = await TMDB.getDetails(item.content_id, 'movie').catch(() => null) ||
                    await TMDB.getDetails(item.content_id, 'tv').catch(() => null);
        }
        return content;
      }));
      grid.innerHTML = items.filter(Boolean).map(content => UI.posterCard(content)).join('');
    } else {
      grid.style.display = 'none';
      if (empty) empty.style.display = 'block';
    }
  }

  async function loadWatchHistory(userId) {
    const grid = document.getElementById('account-history-grid');
    const empty = document.getElementById('history-empty');
    const clearBtn = document.getElementById('clear-history-btn');
    if (!grid) return;

    const history = await Subscriptions.getWatchHistory(userId);

    if (history && history.length > 0) {
      grid.style.display = 'grid';
      empty.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'inline-flex';

      const items = await Promise.all(history.map(async record => {
        let content = null;
        if (window.TMDB) {
          // Use stored content_type if available, otherwise try both
          const preferredType = record.content_type || 'movie';
          content = await TMDB.getDetails(record.content_id, preferredType).catch(() => null);
          if (!content) {
            const altType = preferredType === 'movie' ? 'tv' : 'movie';
            content = await TMDB.getDetails(record.content_id, altType).catch(() => null);
          }
        }
        if (!content) return null;

        // Mock progress formats
        const progressSeconds = record.progress_seconds || 0;
        const totalDuration = (content.duration || 120) * 60; // duration in seconds
        const percent = Math.min(100, Math.round((progressSeconds / totalDuration) * 100)) || 25;
        const remainingMinutes = Math.max(5, Math.round((totalDuration - progressSeconds) / 60));

        const item = {
          id: content.id,
          title: content.title,
          poster: content.poster,
          thumbnail: content.thumbnail || content.poster,
          progress: percent,
          duration: 100,
          timeLeft: remainingMinutes > 60 ? `${Math.floor(remainingMinutes/60)}h left` : `${remainingMinutes}m left`,
          type: content.type
        };

        return item;
      }));

      grid.innerHTML = items.filter(Boolean).map(item => UI.videoCard(item)).join('');

      UI.initVideoCardHovers();

      // Bind Clear History
      if (clearBtn) {
        clearBtn.onclick = () => {
          UI.showModal({
            title: 'Clear Viewing History',
            content: 'Are you sure you want to clear your entire viewing history? This will reset all continue watching rows across the application.',
            confirmText: 'Clear All',
            cancelText: 'Keep History',
            dangerous: true,
            onConfirm: async () => {
              try {
                await window.sb
                  .from('watch_history')
                  .delete()
                  .eq('user_id', userId);

                UI.toast('Viewing history successfully cleared.', 'success');
                await loadWatchHistory(userId);
              } catch (err) {
                UI.toast('Failed to clear viewing history.', 'error');
              }
            }
          });
        };
      }
    } else {
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  return { init };
})();

window.AccountPage = AccountPage;
