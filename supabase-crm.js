(() => {
  'use strict';

  const url = 'https://xjiyiwzzqghhgzxdqvhy.supabase.co';
  const publishableKey = 'sb_publishable_GztD57lKIUwGX1tw8TnzsA_eF7bZMox';
  const logins = new Map([
    ['казарян', 'kazaryan@zemlya.example.com'],
    ['архипов', 'arkhipov@zemlya.example.com'],
    ['стафеев', 'stafeev@zemlya.example.com']
  ]);

  function check({data,error}) {
    if(error) throw error;
    return data;
  }

  window.connectZemlya = function connectZemlya() {
    if(!window.supabase?.createClient) {
      throw new Error('Библиотека Supabase не загрузилась. Проверь интернет и обнови страницу.');
    }
    const client = window.supabase.createClient(url,publishableKey,{
      auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false},
      realtime:{worker:false}
    });
    const leadFields = 'id,assignee,version,data';
    async function importRpc(name,args) {
      const result = await client.rpc(name,args);
      if(result.error?.code === 'PGRST202') {
        throw new Error('Обнови импорт в Supabase. Выполни весь файл supabase-import-fix.sql из новой сборки.');
      }
      return check(result);
    }

    async function revision() {
      const row = check(await client.from('crm_change_clock').select('revision').eq('id',1).maybeSingle());
      if(!row) throw Object.assign(new Error('У аккаунта нет доступа к этой CRM.'),{code:'ZEMLYA_ACCESS'});
      return row.revision;
    }

    async function allRows(table,fields,assignee) {
      const rows = [];
      let cursor = null;
      for(;;) {
        let request = client.from(table).select(fields).order('id',{ascending:true}).limit(250);
        if(assignee) request = request.eq('assignee',assignee);
        if(cursor !== null) request = request.gt('id',cursor);
        const batch = check(await request);
        if(!batch.length) return rows;
        rows.push(...batch);
        cursor = batch.at(-1).id;
      }
    }

    async function snapshot(account,currentRevision=-1,includeImports=true) {
      for(let attempt=0;attempt<4;attempt++) {
        const rev = await revision();
        if(rev === currentRevision) return null;
        const [contacts,members,imports] = await Promise.all([
          allRows('leads',leadFields,account.id),
          allRows('crm_members','id,login,role,active'),
          includeImports && account.role === 'owner' ? allRows('crm_imports','id,data') : []
        ]);
        if(rev !== await revision()) continue;
        if(!members.some(member=>member.id===account.id && member.active)) return {accessRevoked:true};
        return {revision:rev,contacts,members,imports:imports.map(row=>row.data)};
      }
      throw Object.assign(new Error('База сейчас обновляется. Повтори действие через несколько секунд.'),{code:'40001'});
    }

    async function signIn(login,password) {
      const email = logins.get(login.trim().normalize('NFC').toLowerCase());
      if(!email) throw new Error('Логин или пароль неверны.');
      const auth = await client.auth.signInWithPassword({email,password});
      if(auth.error?.code === 'invalid_credentials') throw new Error('Логин или пароль неверны.');
      const {user} = check(auth);
      try {
        const profile = check(await client.from('crm_members').select('id,login,role,active').eq('id',user.id).maybeSingle());
        if(!profile?.active) throw new Error('Для этого аккаунта нужно открыть доступ к CRM в Supabase.');
        return profile;
      } catch(error) {
        await client.auth.signOut({scope:'local'});
        throw error;
      }
    }

    async function watch(account,onChange,onStatus) {
      // Uses the signed-in user's current JWT. Supabase JS updates it on Auth refresh.
      await client.realtime.setAuth();
      const owned = {schema:'public',table:'leads',filter:'assignee=eq.'+account.id};
      const channel = client.channel('zemlya-board-'+account.id)
        .on('postgres_changes',{...owned,event:'INSERT'},onChange)
        .on('postgres_changes',{...owned,event:'UPDATE'},onChange)
        // An UPDATE leaving this user's RLS scope cannot notify the previous assignee.
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'crm_change_clock'},onChange)
        .subscribe(onStatus);
      return () => client.removeChannel(channel);
    }

    return {
      signIn,snapshot,watch,
      onSignedOut(callback) {
        client.auth.onAuthStateChange(event => { if(event === 'SIGNED_OUT') queueMicrotask(callback); });
      },
      async signOut() { check(await client.auth.signOut({scope:'local'})); },
      async getLead(id,assignee) {
        const row = check(await client.from('leads').select(leadFields).eq('id',id).eq('assignee',assignee).maybeSingle());
        if(!row) throw new Error('Карточка больше недоступна.');
        return row;
      },
      async saveLead(id,version,data) {
        check(await client.rpc('zemlya_save_lead',{p_id:id,p_version:version,p_data:data}));
      },
      async importBatch(revision,leads,imports,assignments) {
        return importRpc('zemlya_import_v2',{
          p_revision:revision,p_leads:leads,p_imports:imports,p_assignments:assignments
        });
      },
      async archiveImport(importId,ids) {
        return importRpc('zemlya_archive_import',{p_import_id:importId,p_ids:ids});
      },
      async importDuplicates(importId) {
        return importRpc('zemlya_import_duplicates',{p_import_id:importId});
      },
      async importReport(importId) {
        return importRpc('zemlya_import_report',{p_import_id:importId});
      },
      async restoreUncalledImport(importId) {
        return importRpc('zemlya_restore_uncalled_import',{p_import_id:importId});
      },
      async assign(ids,assignee) {
        return check(await client.rpc('zemlya_assign',{p_ids:ids,p_assignee:assignee}));
      },
      async deleteLead(id) {
        check(await client.rpc('zemlya_delete_lead',{p_id:id}));
      }
    };
  };
})();
