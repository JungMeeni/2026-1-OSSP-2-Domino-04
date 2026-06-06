'use strict';
/**
 * @type {import('sequelize-cli').Migration}
 *
 * [변경 이력]
 * 2025-05-25: gu_id 컬럼의 GuBoundaries 외래키 참조 제거
 *   - 원인: GuBoundaries 테이블 migration이 없어 "Failed to open the referenced table" 오류 발생
 *   - 처리: gu_id는 단순 INTEGER로 유지 (데이터 구조 보존), FK 제약만 제거
 *   - 원본: migrations/_archive/20260504104132-create-place.ORIGINAL.js 에 보관
 *   - 추후 GuBoundaries 기능 구현 시 아카이브 파일 참고하여 복원
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Places', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      gu_id: {
        // GuBoundaries FK 제거됨 — 단순 INTEGER로 보존
        // 복원 방법: _archive/20260504104132-create-place.ORIGINAL.js 참고
        type: Sequelize.INTEGER,
        allowNull: true
      },
      category: {
        type: Sequelize.ENUM('ACCOMMODATION', 'RESTAURANT', 'CAFE', 'ATTRACTION', 'PLAYGROUND', 'STORE', 'SHOP'),
        allowNull: false
      },
      place_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true
      },
      source: {
        type: Sequelize.ENUM('TRIPADVISOR', 'CSV'),
        allowNull: false,
        defaultValue: 'TRIPADVISOR'
      },
      coordinates: {
        type: Sequelize.GEOMETRY('POINT', 4326),
        allowNull: true
      },
      rating: {
        type: Sequelize.DECIMAL(3, 2)
      },
      num_reviews: {
        type: Sequelize.INTEGER
      },
      cached_at: {
        type: Sequelize.DATE
      },
      raw_data: {
        type: Sequelize.JSON,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('Places', ['coordinates'], {
      type: 'SPATIAL',
      name: 'places_coordinates_spatial'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Places');
  }
};