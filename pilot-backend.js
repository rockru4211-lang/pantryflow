(function bootstrapPantryBackend() {
  const config = window.PANTRYFLOW_CONFIG || {};
  const configured = Boolean(
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    !String(config.supabaseUrl).includes('YOUR_PROJECT') &&
    !String(config.supabaseAnonKey).includes('YOUR_PUBLIC')
  );

  class PantryBackend {
    constructor() {
      this.configured = configured;
      this.client = null;
      this.session = null;
      this.profile = null;
      this.recoveryMode = false;
      this.mode = configured ? 'cloud' : 'fallback';
    }

    async init() {
      if (!this.configured) return { mode: this.mode, authenticated: false };
      this.recoveryMode = /(?:[?#&])type=recovery(?:&|$)/.test(window.location.href);
      if (!window.supabase?.createClient) throw new Error('Supabase SDK 尚未載入');
      this.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      this.session = data.session;
      if (this.session) await this.loadProfile();
      this.client.auth.onAuthStateChange((event, session) => {
        this.session = session;
        this.recoveryMode = event === 'PASSWORD_RECOVERY' || this.recoveryMode;
        if (!session) this.profile = null;
      });
      return { mode: this.mode, authenticated: Boolean(this.session), profile: this.profile, recoveryMode: this.recoveryMode };
    }

    callbackUrl() {
      return `${window.location.origin}${window.location.pathname}`;
    }

    async signUp({ displayName, email, password }) {
      if (!this.client) throw new Error('尚未設定 Supabase');
      const { data, error } = await this.client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: this.callbackUrl() }
      });
      if (error) throw error;
      this.session = data.session;
      if (this.session) await this.loadProfile();
      return data;
    }

    async sendPasswordReset(email) {
      if (!this.client) throw new Error('尚未設定 Supabase');
      const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: this.callbackUrl() });
      if (error) throw error;
    }

    async updatePassword(password) {
      if (!this.client) throw new Error('尚未設定 Supabase');
      const { error } = await this.client.auth.updateUser({ password });
      if (error) throw error;
      this.recoveryMode = false;
    }

    async signIn(email, password) {
      if (!this.client) throw new Error('尚未設定 Supabase');
      const { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      this.session = data.session;
      await this.loadProfile();
      return this.profile;
    }

    async signOut() {
      if (!this.client) return;
      const { error } = await this.client.auth.signOut();
      if (error) throw error;
      this.session = null;
      this.profile = null;
    }

    async loadProfile() {
      const userId = this.session?.user?.id;
      if (!userId) return null;
      const { data, error } = await this.client
        .from('profiles')
        .select('id, organization_id, display_name, role, store, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(`登入成功，但無法讀取使用者資料：${error.message}`);
      this.profile = data || {
        id: userId,
        organization_id: null,
        display_name: this.session.user.user_metadata?.display_name || this.session.user.email,
        role: null,
        store: ''
      };
      return this.profile;
    }

    requireCloud() {
      if (!this.client || !this.profile) throw new Error('請先登入 PantryFlow Pilot');
      return this.profile;
    }

    requireAdmin() {
      const profile = this.requireCloud();
      if (profile.role !== 'ADMIN') throw new Error('只有 ADMIN 可以修改盤點設定');
      return profile;
    }

    async createOrganization(name) {
      this.requireCloud();
      const { error } = await this.client.rpc('create_my_organization', { p_name: name });
      if (error) throw error;
      return this.loadProfile();
    }

    async loadCatalog() {
      this.requireCloud();
      const [productsResult, zonesResult, zoneProductsResult, suppliersResult] = await Promise.all([
        this.client.from('products').select('*').eq('is_active', true).order('product_code'),
        this.client.from('count_zones').select('*').eq('is_active', true).order('sort_order'),
        this.client.from('zone_products').select('*').order('sort_order'),
        this.client.from('suppliers').select('*').eq('is_active', true).order('supplier_code')
      ]);
      for (const result of [productsResult, zonesResult, zoneProductsResult, suppliersResult]) {
        if (result.error) throw result.error;
      }
      return {
        products: productsResult.data,
        zones: zonesResult.data,
        zoneProducts: zoneProductsResult.data,
        suppliers: suppliersResult.data
      };
    }

    async loadCatalogSettings() {
      this.requireCloud();
      const [products, zones, zoneProducts, suppliers] = await Promise.all([
        this.client.from('products').select('*').order('name'),
        this.client.from('count_zones').select('*').order('sort_order'),
        this.client.from('zone_products').select('*').order('sort_order'),
        this.client.from('suppliers').select('*').eq('is_active', true).order('name')
      ]);
      for (const result of [products, zones, zoneProducts, suppliers]) if (result.error) throw result.error;
      return { products: products.data, zones: zones.data, zoneProducts: zoneProducts.data, suppliers: suppliers.data };
    }

    async createZone(name) {
      const profile = this.requireAdmin();
      const { data: last } = await this.client.from('count_zones').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await this.client.from('count_zones').insert({
        organization_id: profile.organization_id, name: name.trim(), sort_order: (last?.sort_order || 0) + 10
      }).select().single();
      if (error) throw error;
      return data;
    }

    async updateZone(id, changes) {
      this.requireAdmin();
      const payload = {};
      if (changes.name !== undefined) payload.name = changes.name.trim();
      if (changes.sortOrder !== undefined) payload.sort_order = changes.sortOrder;
      if (changes.isActive !== undefined) payload.is_active = changes.isActive;
      const { data, error } = await this.client.from('count_zones').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    async createCatalogProduct(input) {
      const profile = this.requireAdmin();
      const code = input.productCode?.trim() || `PF-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await this.client.from('products').insert({
        organization_id: profile.organization_id,
        product_code: code,
        name: input.name.trim(),
        specification: '',
        category: input.category,
        base_unit: input.baseUnit.trim(),
        count_unit: input.countUnit.trim(),
        current_supplier_id: input.supplierId || null
      }).select().single();
      if (error) throw error;
      return data;
    }

    async addProductsToZone(zoneId, productIds) {
      this.requireAdmin();
      const { data: products, error: productError } = await this.client.from('products').select('id,count_unit').in('id', productIds);
      if (productError) throw productError;
      const { data: existing, error: existingError } = await this.client.from('zone_products').select('product_id').eq('zone_id', zoneId);
      if (existingError) throw existingError;
      const existingIds = new Set(existing.map(item => item.product_id));
      const rows = products.filter(item => !existingIds.has(item.id)).map((item, index) => ({
        zone_id: zoneId, product_id: item.id, count_unit: item.count_unit, sort_order: existing.length + index
      }));
      if (!rows.length) return [];
      const { data, error } = await this.client.from('zone_products').insert(rows).select();
      if (error) throw error;
      return data;
    }

    async getActiveCountSession() {
      this.requireCloud();
      const { data, error } = await this.client
        .from('inventory_count_sessions')
        .select('*')
        .in('status', ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REVIEWING'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }

    async createCountSession(snapshot) {
      const profile = this.requireCloud();
      const { data, error } = await this.client
        .from('inventory_count_sessions')
        .insert({
          organization_id: profile.organization_id,
          started_by: profile.id,
          status: 'IN_PROGRESS',
          snapshot
        })
        .select()
        .single();
      if (error) throw error;
      const zones = snapshot.zones || [];
      if (zones.length) {
        const { error: progressError } = await this.client.from('count_zone_progress').insert(zones.map(zone => ({
          organization_id: profile.organization_id,
          session_id: data.id,
          zone_id: zone.id,
          status: 'NOT_STARTED'
        })));
        if (progressError) throw progressError;
      }
      return data;
    }

    async loadCountState(sessionId) {
      this.requireCloud();
      const [drafts, entries, progress, discrepancies] = await Promise.all([
        this.client.from('count_drafts').select('*').eq('session_id', sessionId),
        this.client.from('count_entries').select('*').eq('session_id', sessionId).order('entered_at'),
        this.client.from('count_zone_progress').select('*').eq('session_id', sessionId),
        this.client.from('inventory_count_discrepancies').select('*').eq('session_id', sessionId)
      ]);
      for (const result of [drafts, entries, progress, discrepancies]) if (result.error) throw result.error;
      return { drafts: drafts.data, entries: entries.data, progress: progress.data, discrepancies: discrepancies.data };
    }

    async saveCountDraft({ sessionId, zoneId, productId, quantity, unit }) {
      const profile = this.requireCloud();
      const payload = {
        organization_id: profile.organization_id,
        session_id: sessionId,
        zone_id: zoneId,
        product_id: productId,
        quantity,
        unit,
        entered_by: profile.id,
        entered_at: new Date().toISOString()
      };
      const { data, error } = await this.client
        .from('count_drafts')
        .upsert(payload, { onConflict: 'session_id,zone_id,product_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async completeCountZone({ sessionId, zoneId, entries }) {
      const profile = this.requireCloud();
      const productIds = entries.map(entry => entry.productId);
      const { data: existing, error: existingError } = await this.client
        .from('count_entries')
        .select('id, product_id')
        .eq('session_id', sessionId)
        .eq('zone_id', zoneId)
        .eq('entry_type', 'INITIAL_COUNT')
        .in('product_id', productIds);
      if (existingError) throw existingError;
      const existingIds = new Set((existing || []).map(item => item.product_id));
      const newEntries = entries.filter(entry => !existingIds.has(entry.productId)).map(entry => ({
        organization_id: profile.organization_id,
        session_id: sessionId,
        zone_id: zoneId,
        product_id: entry.productId,
        quantity: entry.quantity,
        unit: entry.unit,
        entered_by: profile.id,
        entered_at: entry.enteredAt || new Date().toISOString(),
        entry_type: 'INITIAL_COUNT'
      }));
      let inserted = [];
      if (newEntries.length) {
        const result = await this.client.from('count_entries').insert(newEntries).select();
        if (result.error) throw result.error;
        inserted = result.data;
      }
      const { error: progressError } = await this.client
        .from('count_zone_progress')
        .update({ status: 'COMPLETED', completed_by: profile.id, completed_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('zone_id', zoneId);
      if (progressError) throw progressError;
      const { error: draftError } = await this.client
        .from('count_drafts')
        .delete()
        .eq('session_id', sessionId)
        .eq('zone_id', zoneId);
      if (draftError) throw draftError;
      return [...(existing || []), ...inserted];
    }

    async setCountSessionStatus(sessionId, status) {
      this.requireCloud();
      const changes = { status };
      if (['COMPLETED', 'REVIEWING', 'CLOSED'].includes(status)) changes.completed_at = new Date().toISOString();
      const { data, error } = await this.client
        .from('inventory_count_sessions')
        .update(changes)
        .eq('id', sessionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async appendCountCorrection({ sessionId, zoneId, productId, quantity, unit, parentEntryId, entryType = 'CORRECTION' }) {
      const profile = this.requireCloud();
      const payload = {
        organization_id: profile.organization_id,
        session_id: sessionId,
        zone_id: zoneId,
        product_id: productId,
        quantity,
        unit,
        entered_by: profile.id,
        entry_type: entryType,
        parent_entry_id: parentEntryId
      };
      const { data, error } = await this.client.from('count_entries').insert(payload).select().single();
      if (error) throw error;
      await this.audit('count_entry', data.id, 'COUNT_CORRECTION', null, payload);
      return data;
    }

    async saveDiscrepancy(payload) {
      const profile = this.requireCloud();
      const record = { ...payload, organization_id: profile.organization_id };
      const { data, error } = await this.client
        .from('inventory_count_discrepancies')
        .upsert(record, { onConflict: 'session_id,zone_id,product_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async listCountDiscrepancies() {
      this.requireCloud();
      const { data, error } = await this.client
        .from('inventory_count_discrepancies')
        .select('*, products(id,product_code,name,count_unit), count_zones(id,name), inventory_count_sessions(id,started_at,completed_at,status)')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }

    async getLatestCountReport() {
      this.requireCloud();
      const { data: session, error: sessionError } = await this.client
        .from('inventory_count_sessions')
        .select('*')
        .in('status', ['COMPLETED', 'REVIEWING', 'CLOSED'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return { session: null, entries: [] };
      const { data: entries, error: entryError } = await this.client
        .from('count_entries')
        .select('*, products(id,product_code,name,count_unit), count_zones(id,name)')
        .eq('session_id', session.id)
        .order('entered_at', { ascending: true });
      if (entryError) throw entryError;
      return { session, entries: entries || [] };
    }

    makeBatchNumber() {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const suffix = String(now.getTime()).slice(-3);
      return `#${month}${day}-${suffix}`;
    }

    async uploadReceiptBatch(files) {
      const profile = this.requireCloud();
      if (!files.length) throw new Error('沒有可上傳的照片');
      const batchNumber = this.makeBatchNumber();
      const { data: batch, error: batchError } = await this.client
        .from('receipt_upload_batches')
        .insert({
          organization_id: profile.organization_id,
          batch_number: batchNumber,
          uploaded_by: profile.id,
          status: 'PROCESSING'
        })
        .select()
        .single();
      if (batchError) throw batchError;
      const documents = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const safeName = `${String(index + 1).padStart(3, '0')}-${crypto.randomUUID()}-${String(file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storagePath = `${profile.organization_id}/${batch.id}/${safeName}`;
        const upload = await this.client.storage.from('receipt-documents').upload(storagePath, file, {
          cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg'
        });
        if (upload.error) throw upload.error;
        const documentResult = await this.client.from('receipt_documents').insert({
          organization_id: profile.organization_id,
          batch_id: batch.id,
          storage_path: storagePath,
          original_filename: file.name || `貨單照片_${index + 1}.jpg`,
          mime_type: file.type || 'image/jpeg',
          page_order: index + 1,
          uploaded_by: profile.id
        }).select().single();
        if (documentResult.error) throw documentResult.error;
        documents.push(documentResult.data);
      }
      return { batch, documents };
    }

    async uploadReceiptBatches(files, { sameReceiptMultiPage = false } = {}) {
      this.requireCloud();
      const routing = window.PantryReceiptUploadRouting;
      if (!routing) throw new Error('貨單分流模組尚未載入');
      const groups = routing.groupReceiptFiles(files, sameReceiptMultiPage);
      if (!groups.length) throw new Error('沒有可上傳的照片');
      const results = await routing.settleReceiptGroups(
        groups,
        groupFiles => this.uploadReceiptBatch(groupFiles)
      );
      return {
        successful: results.filter(result => result.ok),
        failed: results.filter(result => !result.ok)
      };
    }

    async listReceiptBatches() {
      this.requireCloud();
      const { data, error } = await this.client
        .from('receipt_upload_batches')
        .select('*, receipt_documents(id, storage_path, original_filename, page_order, mime_type), goods_receipts(id, supplier_id, receipt_date, document_number, subtotal_ex_tax, tax, total_inc_tax, reviewed_at)')
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return data;
    }

    async getReceiptReview(batchId) {
      this.requireCloud();
      const [batch, runs, corrections, mappings, products, suppliers] = await Promise.all([
        this.client.from('receipt_upload_batches').select('*, receipt_documents(*)').eq('id', batchId).single(),
        this.client.from('receipt_ocr_runs').select('*').eq('batch_id', batchId).order('version', { ascending: false }),
        this.client.from('receipt_review_corrections').select('*').eq('batch_id', batchId).order('modified_at'),
        this.client.from('receipt_product_mappings').select('*').eq('batch_id', batchId),
        this.client.from('products').select('*').eq('is_active', true).order('product_code'),
        this.client.from('suppliers').select('*').eq('is_active', true).order('supplier_code')
      ]);
      for (const result of [batch, runs, corrections, mappings, products, suppliers]) if (result.error) throw result.error;
      const latestRun = runs.data?.[0] || null;
      let fields = { data: [], error: null };
      if (latestRun) {
        fields = await this.client.from('receipt_ocr_fields').select('*').eq('ocr_run_id', latestRun.id).order('row_key');
        if (fields.error) throw fields.error;
      }
      return {
        batch: batch.data,
        runs: runs.data,
        latestRun,
        fields: fields.data,
        corrections: corrections.data,
        mappings: mappings.data,
        products: products.data,
        suppliers: suppliers.data
      };
    }

    async processReceiptOcr(batchId) {
      this.requireCloud();
      const { data, error } = await this.client.functions.invoke('process-receipt-ocr', {
        body: { batchId }
      });
      if (error) {
        let detail = error.message;
        try {
          const body = await error.context?.json();
          detail = body?.message || body?.error || detail;
        } catch (_) {
          // Preserve the SDK error when the response is not JSON.
        }
        throw new Error(detail);
      }
      return data;
    }

    async signedDocumentUrl(path, expiresIn = 300) {
      this.requireCloud();
      const { data, error } = await this.client.storage.from('receipt-documents').createSignedUrl(path, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    }

    async saveReceiptCorrection({ batchId, ocrFieldId, oldValue, newValue }) {
      const profile = this.requireCloud();
      const payload = {
        organization_id: profile.organization_id,
        batch_id: batchId,
        ocr_field_id: ocrFieldId,
        old_value: oldValue,
        new_value: newValue,
        modified_by: profile.id
      };
      const { data, error } = await this.client.from('receipt_review_corrections').insert(payload).select().single();
      if (error) throw error;
      await this.audit('receipt_ocr_field', ocrFieldId, 'OCR_CORRECTION', oldValue, newValue);
      return data;
    }

    async mapReceiptProduct({ batchId, rowKey, productId }) {
      const profile = this.requireCloud();
      const { data: existing, error: existingError } = await this.client
        .from('receipt_product_mappings')
        .select('id, product_id')
        .eq('batch_id', batchId)
        .eq('row_key', rowKey)
        .maybeSingle();
      if (existingError) throw existingError;
      const payload = {
        organization_id: profile.organization_id,
        batch_id: batchId,
        row_key: rowKey,
        product_id: productId,
        selected_by: profile.id
      };
      const { data, error } = await this.client
        .from('receipt_product_mappings')
        .upsert(payload, { onConflict: 'batch_id,row_key' })
        .select()
        .single();
      if (error) throw error;
      if (existing?.product_id !== productId) {
        await this.audit('receipt_product_mapping', data.id, 'PRODUCT_MAPPING_CHANGED', existing?.product_id || null, productId);
      }
      return data;
    }

    async createProduct(input) {
      const profile = this.requireCloud();
      if (profile.role !== 'ADMIN') throw new Error('只有 ADMIN 可以建立商品');
      const search = String(input.name || '').trim();
      const safeSearch = search.replace(/[,%()]/g, '');
      const { data: candidates, error: searchError } = await this.client
        .from('products')
        .select('id, product_code, name, specification, count_unit')
        .or(`product_code.ilike.%${safeSearch}%,name.ilike.%${safeSearch}%,specification.ilike.%${safeSearch}%`)
        .limit(8);
      if (searchError) throw searchError;
      if (!input.confirmCreate) return { candidates };
      const payload = {
        organization_id: profile.organization_id,
        product_code: input.productCode,
        name: input.name,
        specification: input.specification || '',
        category: input.category || '其他',
        base_unit: input.unit,
        count_unit: input.unit,
        current_supplier_id: input.supplierId || null
      };
      const { data, error } = await this.client.from('products').insert(payload).select().single();
      if (error) throw error;
      await this.audit('product', data.id, 'PRODUCT_CREATED', null, payload);
      return { product: data, candidates: [] };
    }

    async finalizeReceipt({ batchId, supplierId, receiptDate, documentNumber, totals, lines }) {
      this.requireCloud();
      const { data: receiptId, error } = await this.client.rpc('finalize_goods_receipt', {
        p_batch_id: batchId,
        p_supplier_id: supplierId || null,
        p_receipt_date: receiptDate,
        p_document_number: documentNumber || null,
        p_subtotal_ex_tax: totals.subtotal,
        p_tax: totals.tax,
        p_total_inc_tax: totals.total,
        p_lines: lines
      });
      if (error) throw error;
      const { data: receipt, error: receiptError } = await this.client
        .from('goods_receipts')
        .select('*')
        .eq('id', receiptId)
        .single();
      if (receiptError) throw receiptError;
      return receipt;
    }

    async loadReceiptExportRows() {
      const profile = this.requireCloud();
      const { data: receipts, error: receiptError } = await this.client
        .from('goods_receipts')
        .select('*')
        .order('receipt_date', { ascending: false });
      if (receiptError) throw receiptError;
      if (!receipts.length) return [];
      const receiptIds = receipts.map(item => item.id);
      const batchIds = receipts.map(item => item.source_batch_id);
      const [linesResult, suppliersResult, productsResult, documentsResult] = await Promise.all([
        this.client.from('receipt_lines').select('*').in('receipt_id', receiptIds),
        this.client.from('suppliers').select('id, supplier_code, name'),
        this.client.from('products').select('id, product_code, name, specification'),
        this.client.from('receipt_documents').select('batch_id, original_filename, storage_path').in('batch_id', batchIds)
      ]);
      for (const result of [linesResult, suppliersResult, productsResult, documentsResult]) if (result.error) throw result.error;
      const receiptById = new Map(receipts.map(item => [item.id, item]));
      const supplierById = new Map(suppliersResult.data.map(item => [item.id, item]));
      const productById = new Map(productsResult.data.map(item => [item.id, item]));
      const documentsByBatch = documentsResult.data.reduce((map, item) => {
        const documents = map.get(item.batch_id) || [];
        documents.push(item);
        map.set(item.batch_id, documents);
        return map;
      }, new Map());
      return linesResult.data.map(line => {
        const receipt = receiptById.get(line.receipt_id);
        const supplier = supplierById.get(line.supplier_id || receipt?.supplier_id) || {};
        const product = productById.get(line.product_id) || {};
        return {
          organization_id: profile.organization_id,
          receipt_date: receipt?.receipt_date || '',
          document_number: receipt?.document_number || '',
          supplier_code: supplier.supplier_code || '', supplier_name: supplier.name || '',
          product_code: product.product_code || '', product_name: product.name || '',
          specification: line.specification || product.specification || '',
          unit: line.unit, quantity: Number(line.quantity),
          unit_price_ex_tax: Number(line.unit_price_ex_tax),
          line_subtotal_ex_tax: Number(line.line_subtotal_ex_tax),
          tax_rate: Number(line.tax_rate), tax: Number(line.tax),
          line_total_inc_tax: Number(line.line_total_inc_tax),
          batch_or_expiry: line.batch_or_expiry || '', storage_location: line.storage_location || '',
          original_documents: (documentsByBatch.get(receipt?.source_batch_id) || [])
            .map(document => `${document.original_filename} (${document.storage_path})`).join('；')
        };
      });
    }

    async audit(entityType, entityId, action, oldValue, newValue) {
      const profile = this.requireCloud();
      const { error } = await this.client.from('audit_logs').insert({
        organization_id: profile.organization_id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        old_value: oldValue,
        new_value: newValue,
        user_id: profile.id
      });
      if (error) throw error;
    }
  }

  window.PantryBackend = new PantryBackend();
})();
