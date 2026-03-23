import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function migrate() {
  const lines = await prisma.orderLine.findMany({
    where: { OR: [{ notes: { not: null } }, { photos: { not: null } }] }
  });
  console.log('Lines to migrate:', lines.length);
  
  for (const l of lines) {
    const annotations = l.annotations ? JSON.parse(l.annotations) : [];
    const now = new Date().toISOString();
    
    if (l.notes && l.notes.trim()) {
      annotations.unshift({ type: 'note', text: l.notes.trim(), at: now, by: 'sistema', origin: 'receipt' });
    }
    if (l.photos) {
      try {
        const photos = JSON.parse(l.photos);
        for (const file of photos) {
          annotations.unshift({ type: 'photo', file, at: now, by: 'sistema', origin: 'receipt' });
        }
      } catch (e) { /* ignore parse errors */ }
    }
    
    if (annotations.length > 0) {
      await prisma.orderLine.update({
        where: { id: l.id },
        data: { annotations: JSON.stringify(annotations) }
      });
      console.log(`  Migrated line ${l.id}: ${annotations.length} annotations`);
    }
  }
  
  console.log('Migration complete');
  await prisma.$disconnect();
}

migrate().catch(e => { console.error(e); process.exit(1); });

